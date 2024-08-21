from pathlib import Path

import pandas as pd

from lightweight_charts import Chart
from lightweight_charts_server import ftype, Server, View

directory = Path(__file__).parent


def render(background_color: ftype.Color = ftype.Color("#090008")):
    chart = Chart()

    chart.layout(
        background_color=background_color.hex,
        text_color="#FFFFFF",
        font_size=16,
        font_family="Helvetica",
    )

    chart.candle_style(
        up_color="#00ff55",
        down_color="#ed4807",
        border_up_color="#FFFFFF",
        border_down_color="#FFFFFF",
        wick_up_color="#FFFFFF",
        wick_down_color="#FFFFFF",
    )

    chart.volume_config(up_color="#00ff55", down_color="#ed4807")

    chart.watermark("1D", color="rgba(180, 180, 240, 0.7)")

    chart.crosshair(
        mode="normal",
        vert_color="#FFFFFF",
        vert_style="dotted",
        horz_color="#FFFFFF",
        horz_style="dotted",
    )

    chart.legend(visible=True, font_size=14)

    df = pd.read_csv(directory / "ohlcv.csv")
    chart.set(df)
    return chart


display = View(callback=render)
server = Server(display, title="styling")

if __name__ == "__main__":
    server.serve()
