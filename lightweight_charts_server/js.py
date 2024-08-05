""" 
### A module that can inject JS code or import and execute functions defined in JS. 

- JS code injection uses js/inject.js.
- Interactive JS functions are defined in js/functions.js.
"""

from lightweight_charts_server.system import JS_DIR

inject_js = JS_DIR / "inject.js"


def inject_code(js_code: str):
    line = "\n/*" + "=" * 10 + "*/\n"
    inject_js.write_text(inject_js.read_text() + line + js_code)


def clear_inject():
    inject_js.write_text("")


class Function:
    """Calling functions defined in functions.js"""

    def __init__(self, name: str):
        self.name = name

    def __call__(self, *args):
        """Currently only string input is supported. Python str object -> JS string object"""
        params = ",".join(f"`{arg}`" for arg in args)
        inject_code(f"{self.name}({params})")
