from typing import Callable

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from lightweight_charts import Chart

from lightweight_charts_server.render import View
from lightweight_charts_server.system import STATIC_DIR


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
