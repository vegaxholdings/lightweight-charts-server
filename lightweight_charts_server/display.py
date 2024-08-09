import time
import pprint
import inspect
import traceback
import itertools
import threading
from typing import Callable
from functools import partial

from webview import util, window
from lightweight_charts import Chart

from lightweight_charts_server.ftype import FormType
from lightweight_charts_server.system import CallbackError
from lightweight_charts_server.system import init_render, log
from lightweight_charts_server.system import RENDER_CHUNKS_DIR, RENDER_JS


def inject_js(js_code: str):
    # update index.js
    line = "\n/*" + "=" * 10 + "*/\n"
    before = RENDER_JS.read_text() if RENDER_JS.exists() else ""
    RENDER_JS.write_text(before + line + js_code)

    # update chunks
    chunk_names = sorted(
        [file.name for file in RENDER_CHUNKS_DIR.iterdir()],
        key=lambda x: int(x.split(".")[0]),
    )
    next_chunk_num = int(chunk_names[-1].split(".")[0]) + 1 if chunk_names else 0
    next_chunk_filename = str(next_chunk_num) + ".js"
    (RENDER_CHUNKS_DIR / next_chunk_filename).write_text(js_code)


class JSFunction:

    def __init__(self, name: str):
        self.name = name

    def __call__(self, *args):
        """Currently only string arguments is supported. Python str object -> JS string object"""
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


class View:

    def __init__(self, callback: Callable[..., Chart]):
        self.callback_origin = callback
        self.callback_signature = inspect.signature(callback)
        self.inspect_callback_signature()
        self.chart: Chart | None = None

    def inspect_callback_signature(self):
        """Validation of parameters defined in callback function signature"""

        for name, param in self.callback_signature.parameters.items():
            if param.annotation is inspect._empty:
                raise CallbackError(f"No type definition exists for parameter '{name}'")
            if not issubclass(param.annotation, FormType):
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

    def callback(self, params: dict) -> Chart:
        assert set(self.callback_signature.parameters.keys()) == set(params.keys())
        param_repr = (
            "---------- Parameters ----------\n\n"
            + pprint.pformat(params)
            + "\n\n--------------------------------"
        )
        try:
            start = time.time()
            result = self.callback_origin(**params)
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

    def inject_form(self, params: dict):
        assert set(self.callback_signature.parameters.keys()) == set(params.keys())
        intput_tags = [
            f'<div class="input">{value.to_input(name)}</div>'
            for name, value in params.items()
        ]
        if intput_tags:
            JSFunction("createCustomParameterSection")(
                f""" 
                <form method="post" action="/parameter">
                    {"".join(intput_tags)}
                    <div class="submit">
                        <button type="submit">Apply</button>
                    </div>
                </form>
            """
            )
        else:
            JSFunction("createCustomParameterSection")(
                """
                <form>
                    <p>There are no parameters defined in the callback function.</p>
                </form>
            """
            )

    def render(self, request: dict[str, str] = {}):
        if self.chart:
            self.chart.exit()
            del self.chart
        init_render()
        sig = self.callback_signature.parameters
        default = {name: param.default for name, param in sig.items()}
        params = default | {
            name: sig[name].annotation.from_input(value)
            for name, value in request.items()
        }
        self.chart = self.callback(params)
        self.chart.show()
        self.inject_form(params)


class Stream:

    def __init__(
        self,
        chart: Chart,
        *,
        callback: Callable[[Chart], ...],
        latency: float = 0.1,
    ):
        assert isinstance(chart, Chart)
        self.chart = chart
        self.latency = latency
        self.callback_origin = callback
        self.callback_signature = inspect.signature(callback)
        self.inspect_callback_signature()

    def inspect_callback_signature(self):
        params = dict(self.callback_signature.parameters)
        if len(params) != 1:
            raise CallbackError(
                "The updater function must have one Chart type parameter."
            )
        if tuple(params.values())[0].annotation != Chart:
            raise CallbackError(
                "There is no Chart type annotation in the updater function parameter."
            )

    def callback(self):
        try:
            start = time.time()
            self.callback_origin(self.chart)
            duration = time.time() - start
            log.info(
                f"Callback function has finished. It ran for {duration:.2f} seconds."
            )
        except Exception:
            raise CallbackError(
                "An error occurred in the callback function\n\n"
                + traceback.format_exc()
            )

    def render(self):
        init_render()
        self.chart.show()
        self.thread = threading.Thread(target=partial(self.callback), daemon=True)
        self.thread.start()
