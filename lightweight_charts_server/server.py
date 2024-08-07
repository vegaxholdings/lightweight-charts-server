import asyncio

import uvicorn
from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from lightweight_charts_server.render import View, Stream
from lightweight_charts_server.system import STATIC_DIR, RENDER_CHUNKS_DIR


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
        base_chunk_cnt = sum(1 for _ in RENDER_CHUNKS_DIR.iterdir())
        while True:
            await asyncio.sleep(0.1)
            chunks = sorted(
                [file for file in RENDER_CHUNKS_DIR.iterdir()],
                key=lambda x: int(x.name.split(".")[0]),
            )
            chunk_cnt = len(chunks)
            if chunk_cnt > base_chunk_cnt:
                new_chunks = chunks[base_chunk_cnt - chunk_cnt :]
                script = "\n\n".join([chunk.read_text() for chunk in new_chunks])
                await websocket.send_text(script)
                base_chunk_cnt = chunk_cnt

    def serve(self, port: int = 5000):
        app = FastAPI()
        app.mount("/static", StaticFiles(directory=STATIC_DIR))
        app.get("/", response_class=HTMLResponse)(self.root)
        app.post("/parameter")(self.update_parameter)
        app.websocket("/ws")(self.websocket_endpoint)  # 스트림 없으면 끄자
        self.view.render()
        self.stream.start(self.view.chart)
        uvicorn.run(app, port=port)
