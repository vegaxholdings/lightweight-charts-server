from time import sleep

import pandas as pd
from lightweight_charts import Chart
from lightweight_charts_server import Server, View, Stream

df1 = pd.read_csv(
    "/Users/jeonghoowon/dev/lightweight-charts-server/examples/2_live_data/ohlcv.csv"
)
df2 = pd.read_csv(
    "/Users/jeonghoowon/dev/lightweight-charts-server/examples/2_live_data/next_ohlcv.csv"
)


def render(hello: str = "hi"):
    chart = Chart()
    chart.set(df1)
    return chart


def update(chart: Chart):
    last_close = df1.iloc[-1]["close"]

    for i, series in df2.iterrows():
        chart.update(series)

        if series["close"] > 20 and last_close < 20:
            chart.marker(text="The price crossed $20!")

        last_close = series["close"]
        sleep(0.1)


if __name__ == "__main__":

    server = Server(view=View(callback=render), stream=Stream(streamer=update))
    server.serve(port=5000)
