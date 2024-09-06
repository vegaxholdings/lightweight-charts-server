import multiprocessing

if multiprocessing.get_start_method() != "spawn":
    try:
        # For use Xvfb, All child processors must inherit the Xvfb context.
        multiprocessing.set_start_method("spawn")
    except RuntimeError as e:
        raise ImportError(
            "lightweight_charts_server must be imported before lightweight_charts"
        ) from e

from lightweight_charts_server.server import Server
from lightweight_charts_server.display import View, Stream
from lightweight_charts_server.system import log
