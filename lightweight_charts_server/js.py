""" 
### A module that can inject JS code or import and execute functions defined in JS. 

- JS code injection uses js/inject.js.
- Interactive JS functions are defined in js/functions.js.
"""

from pathlib import Path

root = Path(__file__).parent / "static/js"
inject_path = root / "inject.js"


def inject_code(js_code: str):
    line = "\n/*" + "=" * 10 + "*/\n"
    inject_path.write_text(inject_path.read_text() + line + js_code)


def clear_inject():
    inject_path.write_text("")


class Function:
    """Calling functions defined in functions.js"""

    def __init__(self, name: str):
        self.name = name

    def __call__(self, *args):
        """현재는 문자열 입력만 지원됩니다. Python str객체 -> JS string객체"""
        params = ",".join(f"`{arg}`" for arg in args)
        inject_code(f"{self.name}({params})")
