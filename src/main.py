import inspect
from pathlib import Path
from typing import Callable
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
    js.inject_code(js_code := inject_pywebview(*args, **kwargs))
    return js_code


def intercepted_evaluate_js(self, script, *args, **kwargs):
    js.inject_code(script)
    return evaluate_js(self, script, *args, **kwargs)


util.inject_pywebview = intercepted_inject_pywebview
window.Window.evaluate_js = intercepted_evaluate_js

app = FastAPI()
app.mount("/static", StaticFiles(directory=static_dir_path))
templates = Jinja2Templates(directory=static_dir_path)


@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    return templates.TemplateResponse("main.html", {"request": request})


@app.post("/parameter")
async def parameter(request: Request):
    print(request)
    return {}


class Server:

    input_type = {
        int: "number",
        float: "number",
        str: "text",
        bool: "checkbox",
        datetime: "time",
    }

    def __init__(self, callback: Callable[..., Chart]):
        self.callback = callback
        self.callback_signature = inspect.signature(callback)

    def inject_form(self):
        input_list = []
        for name, param in self.callback_signature.parameters.items():
            if param.annotation is inspect._empty:
                raise KeyError(f"{name} 매개변수에 타입을 제공해주세요!")
            if param.annotation not in self.input_type:
                raise KeyError(f"{param.annotation} 타입은 지원되지 않습니다!")
            input_list.append(
                f"""
            <label for="{name}">{name}:</label>
            <input type="{self.input_type[param.annotation]}>"
            """
            )
        form_html = f""" 
            <form method="post" action="/parameter">
                {"".join(input_list)}
            </form>
        """
        target_js_func = js.Function("createCustomParameterSection")
        target_js_func(form_html)

    def serve(self, port=5000):
        js.clear_inject()
        chart = self.callback()
        chart.show()
        self.inject_form()
        uvicorn.run(app, port=port)
