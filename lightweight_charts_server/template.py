import re
import json

from lightweight_charts import Chart


def escape(target: str, strict: bool = False):
    """
    - Escape the string so that it does not affect the JS that lightweight-charts generates.
    - If an error related to `Unexpected identifier` appears in the JS scope, strict must be set to True.
    """
    escaped_str = json.dumps(target, ensure_ascii=strict)[1:-1]
    if strict:
        return re.sub(r"[^\w\s]", " ", escaped_str)
    return escaped_str


def base_chart(title: str, asset: str, precision: int):
    chart = Chart(toolbox=True)
    chart.precision(precision)
    chart.legend(visible=True, text=escape(title), font_size=15)
    chart.price_line(title=escape(asset))
    chart.time_scale(visible=True)
    chart.layout(background_color="#050500")
    chart.grid(vert_enabled=False, horz_enabled=False)
    chart.candle_style(up_color="#9598A1", down_color="#F23545")
    return chart


def alert_chart(message: str, escape_strict=False):
    chart = Chart()
    chart.layout(background_color="#2B2B43")
    chart.legend(visible=True, text=escape(message, strict=escape_strict), font_size=15)
    return chart
