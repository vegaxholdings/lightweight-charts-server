import time
from pathlib import Path

import pandas as pd
from lightweight_charts import Chart
from lightweight_charts_server import Server, Stream

directory = Path(__file__).parent

df1 = pd.read_csv(directory / "ohlcv.csv")
df2 = pd.read_csv(directory / "next_ohlcv.csv")

chart = Chart(toolbox=True)
chart.set(df1)


def update(chart: Chart):
    last_close = df1.iloc[-1]["close"]

    for i, series in df2.iterrows():
        chart.update(series)

        if series["close"] > 20 and last_close < 20:
            chart.marker(text="The price crossed $20!")

        last_close = series["close"]
        time.sleep(0.1)


if __name__ == "__main__":
    display = Stream(chart, callback=update)
    server = Server(display)
    server.serve()
