import pandas as pd
from lightweight_charts import Chart


def make_chart(hello: str = ""):
    chart = Chart()
    df = pd.read_csv(
        "/Users/jeonghoowon/dev/chart-server/sample/data/setting_data_ohlcv.csv"
    )
    chart.set(df)
    return chart
