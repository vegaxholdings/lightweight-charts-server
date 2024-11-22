import shutil
import logging
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent
STATIC_DIR = ROOT / "static"
RENDER_DIR = STATIC_DIR / "render"
RENDER_JS = RENDER_DIR / "index.js"
CHUNKS_DIR = RENDER_DIR / "chunks"
CHUNKS_NUM = RENDER_DIR / "chunk-num.lock"
LOG_TXT = RENDER_DIR / "log.txt"


def init_render():
    if RENDER_DIR.exists():
        for item in RENDER_DIR.iterdir():
            if item != LOG_TXT:
                if item.is_dir():
                    shutil.rmtree(item)
                else:
                    item.unlink()
    CHUNKS_DIR.mkdir(parents=True, exist_ok=True)
    RENDER_JS.write_text("")
    CHUNKS_NUM.write_text("0")


init_render()


class LogHandler(logging.NullHandler):

    def __init__(self):
        super().__init__()

    def handle(self, record):
        now = datetime.now()
        time = f"{now.month:02d}-{now.day:02d} {now.hour:02d}:{now.minute:02d}:{now.second:02d}"
        func = f"[{record.funcName}]" if record.funcName != "<module>" else ""
        content = f"[{record.levelname}][{time}]{func}: {self.format(record)}"
        print(content)
        with LOG_TXT.open("a") as log:
            log.write(content + "\n")


# Redirect output from the warnings module to the logging module.
logging.captureWarnings(True)
log = logging.getLogger("lightweight-charts-server-logger")
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
        content = (
            f"Invalid callback function\n\n"
            f"------------- Please fix the callback function as per the message below. -------------\n\n"
            f"{self.msg}"
            f"\n\n======================================================================================="
        )
        log.critical(content)
        return content
