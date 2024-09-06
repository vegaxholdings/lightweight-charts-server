import os
import sys
import platform
import subprocess
import multiprocessing


if platform.system() == "Linux" and not os.environ.get("DISPLAY"):
    subprocess.run(["xvfb-run", "-a", "python"] + sys.argv)
    sys.exit()

if multiprocessing.get_start_method() != "spawn":
    try:
        # If use Xvfb, All child processors must inherit the Xvfb context.
        multiprocessing.set_start_method("spawn")
    except RuntimeError as e:
        raise ImportError(
            "lightweight_charts_server must be imported before lightweight_charts"
        ) from e


from lightweight_charts_server.server import Server
from lightweight_charts_server.display import View, Stream
from lightweight_charts_server.system import log
