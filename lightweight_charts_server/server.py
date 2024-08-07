import asyncio
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from lightweight_charts_server.render import View, render_js_list, Stream
from lightweight_charts_server.system import STATIC_DIR, RENDER_DIR


class Server:

    def __init__(self, *, view: View, stream: Stream):
        self.view = view
        self.stream = stream

    async def root(self, request: Request):
        template = Jinja2Templates(directory=STATIC_DIR)
        return template.TemplateResponse("index.html", {"request": request})

    async def update_parameter(self, request: Request):
        parameter = await request.json()
        self.view.render(**parameter)
        return {"result": "success"}

    async def websocket_endpoint(self, websocket: WebSocket):
        await websocket.accept()

        while True:
            await websocket.send_text("hello")
            asyncio.sleep(1)

    def serve(self, port: int = 5000):
        app = FastAPI()
        app.mount("/static", StaticFiles(directory=STATIC_DIR))
        app.get("/", response_class=HTMLResponse)(self.root)
        app.post("/parameter")(self.update_parameter)
        app.websocket("/ws")(self.websocket_endpoint)
        self.view.render()
        self.stream.callback(self.view.chart)
        uvicorn.run(app, port=port)
