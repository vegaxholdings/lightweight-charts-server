import time
from pathlib import Path

import pandas as pd
from lightweight_charts import Chart
from lightweight_charts_server import Server, Stream

directory = Path(__file__).parent

df1 = pd.read_csv(directory / "ohlc.csv")
df2 = pd.read_csv(directory / "ticks.csv")


def create():
    chart = Chart()
    chart.set(df1)
    return chart


def update(chart: Chart):
    for i, tick in df2.iterrows():
        chart.update_from_tick(tick)
        time.sleep(0.03)


if __name__ == "__main__":
    display = Stream(creator=create, updater=update)
    server = Server(display)
    server.serve()
