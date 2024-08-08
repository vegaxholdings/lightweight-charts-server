from pathlib import Path

import pandas as pd
from lightweight_charts import Chart
from lightweight_charts_server import Server, View

directory = Path(__file__).parent


def calculate_sma(df, period: int = 50):
    return pd.DataFrame(
        {"time": df["date"], f"SMA {period}": df["close"].rolling(window=period).mean()}
    ).dropna()


def render(sma: bool = False):
    chart = Chart()
    chart.legend(visible=True)
    df = pd.read_csv(directory / "ohlcv.csv")
    chart.set(df)

    if sma:
        line = chart.create_line("SMA 50")
        sma_data = calculate_sma(df, period=50)
        line.set(sma_data)
    return chart


if __name__ == "__main__":
    display = View(callback=render)
    server = Server(display)
    server.serve()
