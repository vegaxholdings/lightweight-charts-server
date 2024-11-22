"""
FormType: Classes that can define HTML Form creation
and HTTP request processing as Python function signatures
"""

import io
import json
from datetime import datetime
from abc import ABC, abstractmethod

import pandas as pd
from lightweight_charts_server.system import CallbackError


class FormType(ABC):

    @classmethod
    @abstractmethod
    def from_input(cls, value: str):
        """Creates an instance using the string received from the HTTP request."""

    @abstractmethod
    def to_input(self, name: str) -> str:
        """
        - Create an input HTML string to be placed inside the tag below.
        - `<div class="input">...</div>`
        """


class Int(int, FormType):
    """Inheritor of native int type"""

    @classmethod
    def from_input(cls, value: str):
        return cls(value)

    def to_input(self, name: str) -> str:
        return f"""
            <label for="{name}">{name.replace("_", " ")}</label>    
            <input name="{name}" type="number" value="{self}">
            """


class Float(float, FormType):
    """Inheritor of native float type"""

    @classmethod
    def from_input(cls, value: str):
        return cls(value)

    def to_input(self, name: str) -> str:
        return f"""
            <label for="{name}">{name.replace("_", " ")}</label>    
            <input name="{name}" type="number" value="{self}">
            """


class Str(str, FormType):
    """Inheritor of native str type"""

    @classmethod
    def from_input(cls, value: str):
        return cls(value.strip())

    def to_input(self, name: str) -> str:
        return f"""
            <label for="{name}">{name.replace("_", " ")}</label>    
            <input name="{name}" type="text" value="{self}">
            """


class DateTime(datetime, FormType):
    """Inheritor of native datetime type"""

    @classmethod
    def from_input(cls, value: str):
        return cls.fromisoformat(value)

    def to_input(self, name: str) -> str:
        value = self.strftime("%Y-%m-%dT%H:%M:%S")
        return f"""
            <label for="{name}">{name.replace("_", " ")}</label>    
            <input name="{name}" type="datetime-local" value="{value}">
            """

    def __repr__(self):
        return f"<DateTime {self.isoformat()}>"


class DataFrame(pd.DataFrame, FormType):

    @classmethod
    def from_input(cls, value: str):
        if not value:
            return cls({})
        buffer = io.StringIO(value)
        df = pd.read_csv(buffer)
        return cls(df)

    def to_input(self, name: str) -> str:
        return f"""
            <label for="{name}">{name.replace("_", " ")}</label>
            <input type="file" name="{name}" accept=".csv">
            """

    def __repr__(self):
        rows, cols = self.shape
        memory_usage = self.memory_usage(deep=True).sum() / (1024**2)  # MB 단위로 변환
        summary = f"Rows: {rows}, Columns: {cols}, Memory Usage: {memory_usage:.3f} MB"
        return f"<DataFrame {summary}>"


class JSON(FormType):

    def __init__(self, obj: dict | list):
        self.obj = obj

    @classmethod
    def from_input(cls, value: str):
        if not value:
            return cls({})
        buffer = io.StringIO(value)
        obj = json.load(buffer)
        return cls(obj)

    def to_input(self, name: str) -> str:
        return f"""
            <label for="{name}">{name.replace("_", " ")}</label>
            <input type="file" name="{name}" accept=".json">
            """

    def __repr__(self):
        obj_str = str(self.obj)
        if len(obj_str) > 100:
            return f"<JSON {obj_str[:100]}...>"
        else:
            return f"<JSON {obj_str}>"


class Bool(FormType):

    def __init__(self, value: bool):
        assert isinstance(value, bool)
        self.value = value

    @classmethod
    def from_input(cls, value: str):
        return cls(bool(value))

    def to_input(self, name: str) -> str:
        return f"""
            <label for="{name}">{name.replace("_", " ")}</label>    
            <input name="{name}" type="checkbox" {"checked" if self.value else ""}>
            """

    def __repr__(self):
        return f"<Bool {self.value}>"


class Color(FormType):

    def __init__(self, hex_str: str):
        if not hex_str.startswith("#"):
            raise CallbackError(f"hex_str must start with '#'")
        hexadecimal = "0123456789abcdefABCDEF"
        _hex = hex_str[1:]
        if not len(_hex) in (3, 6) and all(s in hexadecimal for s in _hex):
            raise CallbackError(f"{hex_str} is not a valid hex color FormTypeat.")
        self.hex = hex_str

    @classmethod
    def from_input(cls, value: str):
        return cls(hex_str=value)

    def to_input(self, name: str):
        return f"""
            <label for="{name}">{name.replace("_", " ")}</label>    
            <input name="{name}" type="color" value="{self.hex}">
            """

    def __repr__(self):
        return f"<Color {self.hex}>"


class _Options(FormType):
    options: list[str]

    def __init__(self, selected: str):
        assert isinstance(selected, str)
        self.selected = selected
        if selected not in self.options:
            raise CallbackError(
                f"{selected}, an option not in {self.options}, is not allowed"
            )

    @classmethod
    def from_input(cls, value: str):
        return cls(value)

    def to_input(self, name: str):
        tags = []
        for option in self.options:
            if option == self.selected:
                tags.append(f'<option value="{option}" selected>{option}</option>')
            else:
                tags.append(f'<option value="{option}">{option}</option>')
        return f"""
            <label for="{name}">{name.replace("_", " ")}</label>
            <select name="{name}">{"".join(tags)}</select>
            """

    def __repr__(self):
        return f"<Options {self.options} selected='{self.selected}'>"


def options(*values: str) -> _Options:
    if all(not isinstance(value, str) for value in values):
        raise ValueError("options only accept strings")
    return type("Options", (_Options,), {"options": values})
