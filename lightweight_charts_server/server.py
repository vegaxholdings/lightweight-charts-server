import asyncio

import uvicorn
from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.websockets import WebSocketDisconnect

from lightweight_charts_server.display import View, Stream
from lightweight_charts_server.system import STATIC_DIR, CHUNKS_DIR


class Server:

    def __init__(
        self,
        display: View | Stream,
        host: str = "0.0.0.0",
        port: int = 80,
        title: str = "Chart",
    ):
        self.port = port
        self.host = host
        self.title = title
        self.display = display
        self.display_type = display.__class__
        if self.display_type not in [View, Stream]:
            raise TypeError(f"{self.display_type} is not a valid display type.")

    async def root(self, request: Request):
        template = Jinja2Templates(directory=STATIC_DIR)
        return template.TemplateResponse(
            "index.html", {"request": request, "title": self.title}
        )

    async def view_router(self, request: Request):
        self.display.render(await request.json())
        return {"result": "success"}

    async def stream_router(self, websocket: WebSocket):
        await websocket.accept()
        base_chunk_cnt = sum(1 for _ in CHUNKS_DIR.iterdir())
        while True:
            await asyncio.sleep(self.display.latency)
            chunks = sorted(
                [file for file in CHUNKS_DIR.iterdir()],
                key=lambda x: int(x.name.split(".")[0]),
            )
            chunk_cnt = len(chunks)
            if chunk_cnt > base_chunk_cnt:
                new_chunks = chunks[base_chunk_cnt - chunk_cnt :]
                script = "\n\n".join([chunk.read_text() for chunk in new_chunks])
                try:
                    await websocket.send_text(script)
                except WebSocketDisconnect:
                    break
                base_chunk_cnt = chunk_cnt

    def serve(self):
        app = FastAPI()
        app.mount("/static", StaticFiles(directory=STATIC_DIR))
        app.get("/", response_class=HTMLResponse)(self.root)
        if self.display_type == View:
            app.post("/view-parameter")(self.view_router)
            self.display.render()
        elif self.display_type == Stream:
            app.websocket("/stream")(self.stream_router)
            self.display.render()
        uvicorn.run(app, host=self.host, port=self.port)
