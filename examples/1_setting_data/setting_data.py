from pathlib import Path

import pandas as pd

from lightweight_charts import Chart
from lightweight_charts_server import View, Server

directory = Path(__file__).parent


def render():
    chart = Chart()
    df = pd.read_csv(directory / "ohlcv.csv")
    chart.set(df)
    return chart


if __name__ == "__main__":
    display = View(callback=render)
    server = Server(display)
    server.serve()
