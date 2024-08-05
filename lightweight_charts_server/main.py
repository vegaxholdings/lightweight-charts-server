import time
import inspect
import traceback
import itertools
from datetime import datetime
from pprint import pformat
from typing import Callable, ParamSpec

import uvicorn
from webview import util, window
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from lightweight_charts import Chart

from lightweight_charts_server import js
from lightweight_charts_server.system import STATIC_DIR, log


class CallbackError(Exception):

    def __init__(self, msg=""):
        super().__init__(msg)
        self.msg = msg

    def __str__(self):
        return (
            f"Invalid callback function\n"
            f"------------- Please fix the callback function as per the message below. -------------\n\n"
            f"{self.msg}"
            f"\n\n======================================================================================="
        )


# ========== Enables interception of JavaScript injected through webview. ==========

inject_pywebview = util.inject_pywebview
evaluate_js = window.Window.evaluate_js


def _intercepted_inject_pywebview(*args, _cnt=itertools.count(), **kwargs):
    js.inject_code(js_code := inject_pywebview(*args, **kwargs))
    if next(_cnt):  # inject_pywebview is called more than once
        raise CallbackError(
            "The callback function must create only one Chart instance!\n"
            "An error occurred because the given callback function created more than one Chart instance. "
            "Please check and fix the callback function code."
        )
    return js_code


def _intercepted_evaluate_js(self, script, *args, **kwargs):
    js.inject_code(script)
    return evaluate_js(self, script, *args, **kwargs)


util.inject_pywebview = _intercepted_inject_pywebview
window.Window.evaluate_js = _intercepted_evaluate_js

# ==================================================================================

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
            + pformat(parameters)
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
        inject = js.Function("createCustomParameterSection")
        if input_tags:
            inject(
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
            inject(
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
        js.clear_inject()
        self.chart = self.callback(**kwargs)
        self.chart.show()
        self.inject_form()


class Server:

    def __init__(self, *, callback: Callable[..., Chart]):
        self.view = View(callback)

    async def root(self, request: Request):
        templates = Jinja2Templates(directory=STATIC_DIR)
        return templates.TemplateResponse("main.html", {"request": request})

    async def update_parameter(self, request: Request):
        parameter = await request.json()
        self.view.render(**parameter)
        return {"result": "success"}

    def serve(self, port: int = 5000):
        app = FastAPI()
        app.mount("/static", StaticFiles(directory=STATIC_DIR))
        app.get("/", response_class=HTMLResponse)(self.root)
        app.post("/parameter")(self.update_parameter)
        self.view.render()
        uvicorn.run(app, port=port)
