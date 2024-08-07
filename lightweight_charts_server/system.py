import os
import shutil
import logging
from datetime import datetime
from pathlib import Path

import psutil

ROOT = Path(__file__).parent
STATIC_DIR = ROOT / "static"
RENDER_DIR = STATIC_DIR / "render"
RENDER_JS = RENDER_DIR / "index.js"
RENDER_CHUNKS_DIR = RENDER_DIR / "chunks"


def init_render():
    if RENDER_DIR.exists():
        shutil.rmtree(RENDER_DIR)
    RENDER_CHUNKS_DIR.mkdir(parents=True)
    RENDER_JS.write_text("")


class LogHandler(logging.NullHandler):
    pid = os.getpid()

    def __init__(self):
        super().__init__()

    def handle(self, record):
        now = datetime.now()
        memory = psutil.virtual_memory()
        memory_used = memory.total - memory.available
        memory_percent = (memory_used / memory.total) * 100

        disk = psutil.disk_usage("/")
        disk_used = disk.total - disk.free
        disk_percent = (disk_used / disk.total) * 100

        memory_percent = f"{memory_percent:.0f}%"
        disk_percent = f"{disk_percent:.0f}%"
        memory_gb = f"{memory_used * 1e-9:.0f}GB"
        disk_gb = f"{disk_used * 1e-9:.0f}GB"

        memory_status = f"Memory: {memory_gb}({memory_percent})"
        disk_status = f"Disk: {disk_gb}({disk_percent})"
        time = f"{now.month:02d}-{now.day:02d} {now.hour:02d}:{now.minute:02d}:{now.second:02d}"
        content = f"[{record.levelname}][{time}][pid:{self.pid}][{disk_status}][{memory_status}]: {self.format(record)}"
        print(content)


# Redirect output from the warnings module to the logging module.
logging.captureWarnings(True)
log = logging.getLogger("app")
log.propagate = False  # Prevent it from spreading to other logging outputs such as FastAPI or Uvicorn.
log.setLevel(logging.DEBUG)
formatter = logging.Formatter("%(message)s")
log_handler = LogHandler()
log_handler.setFormatter(formatter)
log_handler.setLevel(logging.DEBUG)
log.addHandler(log_handler)


class CallbackError(Exception):

    def __init__(self, msg=""):
        super().__init__(msg)
        self.msg = msg

    def __str__(self):
        return (
            f"Invalid callback function\n\n"
            f"------------- Please fix the callback function as per the message below. -------------\n\n"
            f"{self.msg}"
            f"\n\n======================================================================================="
        )
