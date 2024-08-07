import asyncio

import uvicorn
from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from lightweight_charts_server.display import View, Stream
from lightweight_charts_server.system import STATIC_DIR, RENDER_CHUNKS_DIR


class Server:

    def __init__(self, display: View | Stream, host: str = "0.0.0.0", port: int = 80):
        self.port = port
        self.host = host

        self.display = display
        self.display_type = display.__class__
        if self.display_type not in [View, Stream]:
            raise TypeError(f"{self.display_type} is not a valid display type.")

    async def root(self, request: Request):
        template = Jinja2Templates(directory=STATIC_DIR)
        return template.TemplateResponse("index.html", {"request": request})

    async def update_parameter(self, request: Request):
        parameter = await request.json()
        self.display.render(**parameter)
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

    def serve(self):
        app = FastAPI()
        app.mount("/static", StaticFiles(directory=STATIC_DIR))
        app.get("/", response_class=HTMLResponse)(self.root)
        if self.display_type == View:
            app.post("/parameter")(self.update_parameter)
            self.display.render()
        elif self.display_type == Stream:
            app.websocket("/ws")(self.websocket_endpoint)
            self.display.render()
        uvicorn.run(app, host=self.host, port=self.port)
