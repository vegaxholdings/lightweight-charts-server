import pandas as pd
from lightweight_charts import Chart

import chart_server


def make_chart():
    chart = Chart()
    df = pd.read_csv("example_data/setting_data_ohlcv.csv")
    chart.set(df)
    return chart


if __name__ == "__main__":
    chart_server.run(make_chart)
