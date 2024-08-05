import inspect
import traceback
from pathlib import Path
from typing import Callable, ParamSpec
from datetime import datetime

import uvicorn
from webview import util, window
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from lightweight_charts import Chart

from src import js

static_dir_path = Path(__file__).parent / "static"

# Avoid memory re-references
inject_pywebview = util.inject_pywebview
evaluate_js = window.Window.evaluate_js


def intercepted_inject_pywebview(*args, **kwargs):
    print("inject pywebview!!")
    js.inject_code(js_code := inject_pywebview(*args, **kwargs))
    return js_code


def intercepted_evaluate_js(self, script, *args, **kwargs):
    js.inject_code(script)
    return evaluate_js(self, script, *args, **kwargs)


util.inject_pywebview = intercepted_inject_pywebview
window.Window.evaluate_js = intercepted_evaluate_js


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
        try:
            result = self.callback_func(**kwargs)
        except Exception:
            raise CallbackError(
                "An error occurred in the callback function\n\n"
                + traceback.format_exc()
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
                <label for="{name}">{name}</label>
                <input name="{name}" type="{dtype["input"]}" value="{dtype['encoder'](param.default)}">
            </div>
            """
            )
        form_html = f""" 
            <form method="post" action="/parameter">
                {"".join(input_tags)}
                <div class="submit">
                    <button type="submit">Apply</button>
                </div>
            </form>
        """
        js.Function("createCustomParameterSection")(form_html)

    def create(self, **kwargs: P.kwargs):
        """Create a frontend. If it was previously created, it will be overwritten."""
        if self.chart:
            self.chart.exit()
            del self.chart
        js.clear_inject()
        self.chart = self.callback(**kwargs)
        self.chart.show()
        self.inject_form()


app = FastAPI()
app.mount("/static", StaticFiles(directory=static_dir_path))
templates = Jinja2Templates(directory=static_dir_path)


@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    return templates.TemplateResponse("main.html", {"request": request})


def run(callback: Callable[..., Chart], port: int = 5000):
    view = View(callback)
    view.create()

    @app.post("/parameter")
    async def update_parameter(request: Request):
        parameter = await request.json()
        import time

        time.sleep(3)  # imitating real situations

        view.create(**parameter)

        return {"result": "success"}

    uvicorn.run(app, port=port)
