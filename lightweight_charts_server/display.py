import time
import pprint
import inspect
import traceback
import threading
from typing import Callable
from functools import partial

import portalocker
from webview import window
from lightweight_charts import Chart

from lightweight_charts_server import ftype, template
from lightweight_charts_server.system import CallbackError
from lightweight_charts_server.system import init_render, log
from lightweight_charts_server.system import RENDER_JS, CHUNKS_DIR, CHUNKS_NUM


def inject_js(js_code: str):
    # This code is injected inside pywebview and its environment is not safe for concurrency.
    with portalocker.Lock(CHUNKS_NUM, timeout=1, mode="r+") as file:
        # Ensures chunks are created in the correct units and order
        before_chunk_num = int(file.read())
        chunk_num = before_chunk_num + 1
        chunk_filename = str(chunk_num) + ".js"
        # create chunk
        (CHUNKS_DIR / chunk_filename).write_text(js_code)
        # update index.js
        with RENDER_JS.open("a") as js:
            js.write("\n\n" + js_code)
        file.seek(0)
        file.write(str(chunk_num))
    # lightweight_charts sometimes generates invalid JS code,
    # which is likely due to the read/write operations being exposed to concurrency.
    # So, this also solves a fatal problem with lightweight_charts itself.


evaluate_js = window.Window.evaluate_js


def tracked_evaluate_js(self, js_code: str, *args, **kwargs):
    inject_js(js_code)
    return evaluate_js(self, js_code, *args, **kwargs)


window.Window.evaluate_js = tracked_evaluate_js


class View:

    def __init__(self, callback: Callable[..., Chart]):
        self.callback_origin = callback
        self.callback_signature = inspect.signature(callback)
        self.inspect_callback_signature()
        self.chart: Chart | None = None

    def inspect_callback_signature(self):
        """Validation of parameters defined in callback function signature"""

        for name, param in self.callback_signature.parameters.items():
            if param.annotation is inspect._empty:
                raise CallbackError(f"No type definition exists for parameter '{name}'")
            if not issubclass(param.annotation, ftype.FormType):
                raise CallbackError(
                    f"The type defined in the '{name}' parameter, "
                    f"{param.annotation}, is not supported"
                )
            if param.default is inspect._empty:
                raise CallbackError(f"No default value defined for parameter '{name}'")
            if not isinstance(param.default, param.annotation):
                raise CallbackError(
                    f"The type defined in the '{name}' parameter is different from the default type\n"
                    f"Detail: The type defined for the '{name}' parameter is {param.annotation}, "
                    f"but the type of the default value is {type(param.default)}."
                )

    def callback(self, params: dict) -> Chart:
        assert set(self.callback_signature.parameters.keys()) == set(params.keys())
        param_repr = (
            "---------- Parameters ----------\n\n"
            + pprint.pformat(params)
            + "\n\n--------------------------------"
        )
        try:
            start = time.time()
            result = self.callback_origin(**params)
            duration = time.time() - start
            log.info(
                f"Callback function executed in {duration:.2f} seconds\n" + param_repr
            )
        except Exception as e:
            log.critical(traceback.format_exc())
            message = f"{e.__class__.__name__} {str(e)}"
            return template.alert_chart(message, escape_strict=True)
        if not isinstance(result, Chart):
            raise CallbackError(
                "The callback function must return a Chart object.\n\n"
                f"Return of callback function: {result}"
            )
        return result

    def inject_form(self, params: dict):
        assert set(self.callback_signature.parameters.keys()) == set(params.keys())
        intput_tags = [
            f'<div class="input">{value.to_input(name)}</div>'
            for name, value in params.items()
        ]
        if intput_tags:
            inject_js(
                f""" 
                createCustomParameterSection(`
                    <form method="post" action="/parameter">
                        {"".join(intput_tags)}
                        <div class="submit">
                            <button type="submit">Apply</button>
                        </div>
                    </form>
                `)
            """
            )
        else:
            inject_js(
                f""" 
                createCustomParameterSection(`
                    <form>
                        <p>There are no parameters defined in the callback function.</p>
                    </form>
                `)
            """
            )

    def render(self, request: dict[str, str] = {}):
        if self.chart:
            self.chart.exit()
            del self.chart
        init_render()
        sig = self.callback_signature.parameters
        # A line of code to explicitly assign everything when running it for the first time.
        default = {name: param.default for name, param in sig.items()}
        update = {}

        for name, value in request.items():
            if sig[name].annotation in [ftype.DataFrame, ftype.JSON] and not value:
                # The default value of the file type is not passed to the Form.
                # Therefore, continue so that param.default can be used as is.
                continue
            update[name] = sig[name].annotation.from_input(value)

        params = default | update
        self.chart = self.callback(params)
        self.chart.show()
        self.inject_form(params)


class Stream:

    def __init__(
        self,
        chart: Chart,
        *,
        callback: Callable[[Chart], ...],
        latency: float = 0.1,
    ):
        assert isinstance(chart, Chart)
        self.chart = chart
        self.latency = latency
        self.callback_origin = callback
        self.callback_signature = inspect.signature(callback)
        self.inspect_callback_signature()

    def inspect_callback_signature(self):
        params = dict(self.callback_signature.parameters)
        if len(params) != 1:
            raise CallbackError(
                "The updater function must have one Chart type parameter."
            )
        if tuple(params.values())[0].annotation != Chart:
            raise CallbackError(
                "There is no Chart type annotation in the updater function parameter."
            )

    def callback(self):
        try:
            start = time.time()
            self.callback_origin(self.chart)
            duration = time.time() - start
            log.info(
                f"Callback function has finished. It ran for {duration:.2f} seconds."
            )
        except Exception:
            raise CallbackError(
                "An error occurred in the callback function\n\n"
                + traceback.format_exc()
            )

    def render(self):
        init_render()
        self.chart.show()
        self.thread = threading.Thread(target=partial(self.callback), daemon=True)
        self.thread.start()
