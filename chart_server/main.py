from pathlib import Path
from typing import Callable

import uvicorn
from webview import util, window
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from lightweight_charts import Chart

static_dir_path = Path(__file__).parent / "static"
inject_js_path = static_dir_path / "inject.js"


def inject_js(js_code: str):
    line = "\n/*" + "=" * 10 + "*/\n"
    inject_js_path.write_text(inject_js_path.read_text() + line + js_code)


def clear_js():
    inject_js_path.write_text("")


def attach_injector(inject_pywebview):
    def wrapper(*args, **kwargs):
        js = inject_pywebview(*args, **kwargs)
        inject_js(js)
        return js

    return wrapper


util.inject_pywebview = attach_injector(util.inject_pywebview)


def attach_injector(evaluate_js):
    def wrapper(self, script, *args, **kwargs):
        inject_js(script)
        result = evaluate_js(self, script, *args, **kwargs)
        return result

    return wrapper


window.Window.evaluate_js = attach_injector(window.Window.evaluate_js)


app = FastAPI()
app.mount("/static", StaticFiles(directory=static_dir_path))
templates = Jinja2Templates(directory=static_dir_path)


@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("main.html", {"request": request})


def run(callback: Callable[..., Chart], port=5000):
    clear_js()
    chart = callback()
    chart.show()
    uvicorn.run(app, port=port)
