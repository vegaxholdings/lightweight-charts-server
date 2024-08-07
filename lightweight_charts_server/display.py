import time
import pprint
import inspect
import traceback
import itertools
import threading
from datetime import datetime
from functools import partial
from typing import Callable, ParamSpec

from webview import util, window
from lightweight_charts import Chart

from lightweight_charts_server.system import CallbackError
from lightweight_charts_server.system import init_render, log
from lightweight_charts_server.system import RENDER_CHUNKS_DIR, RENDER_JS


def inject_js(js_code: str):
    # update chunks
    chunk_names = sorted(
        [file.name for file in RENDER_CHUNKS_DIR.iterdir()],
        key=lambda x: int(x.split(".")[0]),
    )
    next_chunk_num = int(chunk_names[-1].split(".")[0]) + 1 if chunk_names else 0
    next_chunk_filename = str(next_chunk_num) + ".js"
    (RENDER_CHUNKS_DIR / next_chunk_filename).write_text(js_code)
    # update index.js
    line = "\n/*" + "=" * 10 + "*/\n"
    before = RENDER_JS.read_text() if RENDER_JS.exists() else ""
    RENDER_JS.write_text(before + line + js_code)


class JSFunction:

    def __init__(self, name: str):
        self.name = name

    def __call__(self, *args):
        """Currently only string input is supported. Python str object -> JS string object"""
        params = ",".join(f"`{arg}`" for arg in args)
        inject_js(f"{self.name}({params})")


inject_pywebview = util.inject_pywebview
evaluate_js = window.Window.evaluate_js


def tracked_inject_pywebview(*args, _cnt=itertools.count(), **kwargs):
    inject_js(js_code := inject_pywebview(*args, **kwargs))
    if next(_cnt):  # inject_pywebview is called more than once
        raise CallbackError(
            "The callback function must create only one Chart instance!\n"
            "An error occurred because the given callback function created more than one Chart instance. "
            "Please check and fix the callback function code."
        )
    return js_code


def tracked_evaluate_js(self, js_code: str, *args, **kwargs):
    inject_js(js_code)
    return evaluate_js(self, js_code, *args, **kwargs)


util.inject_pywebview = tracked_inject_pywebview
window.Window.evaluate_js = tracked_evaluate_js

P = ParamSpec("P")


class View:

    # Callback function parameter type processing definition
    dtypes = {
        int: {
            "input": "number",  # Python type -> HTML input type
            "encoder": lambda x: x,  # Callback parameter -> HTML input value
            "decoder": lambda x: int(x),  # HTTP Request json -> Callback parameter
        },
        float: {
            "input": "number",
            "encoder": lambda x: x,
            "decoder": lambda x: float(x),
        },
        str: {
            "input": "text",
            "encoder": lambda x: x,
            "decoder": lambda x: str(x),
        },
        bool: {
            "input": "checkbox",
            "encoder": lambda x: str(x).lower(),
            "decoder": lambda x: bool(x),
        },
        datetime: {
            "input": "datetime-local",
            "encoder": lambda x: x.strftime("%Y-%m-%dT%H:%M:%S"),
            "decoder": lambda x: datetime.fromisoformat(x),
        },
    }

    def __init__(self, callback: Callable[P, Chart]):
        self.callback_origin = callback
        self.callback_signature = inspect.signature(callback)
        self.inspect_callback_signature()
        self.chart: Chart | None = None

    def inspect_callback_signature(self):
        """Validation of parameters defined in callback function signature"""

        for name, param in self.callback_signature.parameters.items():
            if param.annotation is inspect._empty:
                raise CallbackError(f"No type definition exists for parameter '{name}'")
            if param.annotation not in self.dtypes:
                raise CallbackError(
                    f"The type defined in the '{name}' parameter, "
                    f"{param.annotation}, is not supported"
                )
            if param.default is inspect._empty:
                raise CallbackError(f"No default value defined for parameter '{name}'")
            if not isinstance(param.default, param.annotation):
                raise CallbackError(
                    f"The type defined in the '{name}' parameter is different from the default type\n"
                    f"Detail: The type defined for the '{name}' parameter is {param.annotation}, "
                    f"but the type of the default value is {type(param.default)}."
                )

    def callback(self, **kwargs: P.kwargs) -> Chart:
        parameters = {
            name: param.default
            for name, param in self.callback_signature.parameters.items()
        } | kwargs
        param_repr = (
            "---------- Parameters ----------\n\n"
            + pprint.pformat(parameters)
            + "\n\n--------------------------------"
        )
        try:
            start = time.time()
            result = self.callback_origin(**parameters)
            duration = time.time() - start
            log.info(
                f"Callback function executed in {duration:.2f} seconds\n" + param_repr
            )
        except Exception:
            raise CallbackError(
                "An error occurred in the callback function\n\n"
                f"{traceback.format_exc()}\n{param_repr}"
            )
        if not isinstance(result, Chart):
            raise CallbackError(
                "The callback function must return a Chart object.\n\n"
                f"Return of callback function: {result}"
            )
        return result

    def inject_form(self):
        input_tags = []
        for name, param in self.callback_signature.parameters.items():
            dtype = self.dtypes[param.annotation]
            input_tags.append(
                f"""
            <div class="input">
                <label for="{name}">{name.replace("_", " ")}</label>
                <input name="{name}" type="{dtype["input"]}" value="{dtype['encoder'](param.default)}">
            </div>
            """
            )
        js_create_custom_parameter_section = JSFunction("createCustomParameterSection")
        if input_tags:
            js_create_custom_parameter_section(
                f""" 
                <form method="post" action="/parameter">
                    {"".join(input_tags)}
                    <div class="submit">
                        <button type="submit">Apply</button>
                    </div>
                </form>
            """
            )
        else:
            js_create_custom_parameter_section(
                """
                <form>
                    <p>There are no parameters defined in the callback function.</p>
                </form>
            """
            )

    def render(self, **kwargs: P.kwargs):
        if self.chart:
            self.chart.exit()
            del self.chart
        init_render()
        self.chart = self.callback(**kwargs)
        self.chart.show()
        self.inject_form()


class Stream:

    def __init__(
        self,
        *,
        creator: Callable[[], Chart],
        updater: Callable[[Chart], ...],
    ):
        self.creator = creator
        self.updater = updater
        self.inspect_callback_signature()

    def inspect_callback_signature(self):
        creator_signature = inspect.signature(self.creator)
        updater_signature = inspect.signature(self.updater)
        updater_params = dict(updater_signature.parameters)

        if creator_signature.parameters:
            raise CallbackError("The creator function must not have any parameters.")
        if len(updater_params) != 1:
            raise CallbackError(
                "The updater function must have one Chart type parameter."
            )
        if tuple(updater_params.values())[0].annotation != Chart:
            raise CallbackError(
                "There is no Chart type annotation in the updater function parameter."
            )

    def callback(self):
        try:
            start = time.time()
            created = self.creator()
            duration = time.time() - start
            log.info(f"Creator function executed in {duration:.2f} seconds")
        except:
            raise CallbackError(
                "An error occurred in the creator function\n\n"
                f"{traceback.format_exc()}"
            )
        if not isinstance(created, Chart):
            raise CallbackError(
                "The creator function must return a Chart object.\n\n"
                f"Return of creator function: {created}"
            )
        created.show()
        try:
            log.info(f"Updater function start")
            start = time.time()
            self.updater(created)
            duration = time.time() - start
            log.info(
                f"Updater function has finished. It ran for {duration:.2f} seconds."
            )
        except Exception:
            raise CallbackError(
                "An error occurred in the updater function\n\n" + traceback.format_exc()
            )

    def render(self):
        init_render()
        self.thread = threading.Thread(target=partial(self.callback))
        self.thread.start()
