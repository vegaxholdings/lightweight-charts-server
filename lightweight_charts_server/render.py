import time
import pprint
import inspect
import traceback
import itertools
from datetime import datetime
from typing import Callable, ParamSpec

from webview import util, window
from lightweight_charts import Chart

from lightweight_charts_server.system import JS_DIR, log, CallbackError

inject_js_path = JS_DIR / "inject.js"


def inject_js(js_code: str):
    line = "\n/*" + "=" * 10 + "*/\n"
    inject_js_path.write_text(inject_js_path.read_text() + line + js_code)


def clear_js():
    inject_js_path.write_text("")


class JSFunction:

    def __init__(self, name: str):
        self.name = name

    def __call__(self, *args):
        """Currently only string input is supported. Python str object -> JS string object"""
        params = ",".join(f"`{arg}`" for arg in args)
        inject_js(f"{self.name}({params})")


inject_pywebview = util.inject_pywebview
evaluate_js = window.Window.evaluate_js


def _intercepted_inject_pywebview(*args, _cnt=itertools.count(), **kwargs):
    inject_js(js_code := inject_pywebview(*args, **kwargs))
    if next(_cnt):  # inject_pywebview is called more than once
        raise CallbackError(
            "The callback function must create only one Chart instance!\n"
            "An error occurred because the given callback function created more than one Chart instance. "
            "Please check and fix the callback function code."
        )
    return js_code


def _intercepted_evaluate_js(self, script, *args, **kwargs):
    inject_js(script)
    return evaluate_js(self, script, *args, **kwargs)


util.inject_pywebview = _intercepted_inject_pywebview
window.Window.evaluate_js = _intercepted_evaluate_js

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
        self.callback_func = callback
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
            result = self.callback_func(**parameters)
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
        clear_js()
        self.chart = self.callback(**kwargs)
        self.chart.show()
        self.inject_form()
