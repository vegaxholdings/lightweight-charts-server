import pandas as pd
from lightweight_charts import Chart

from datetime import datetime


def make_chart(
    dt: datetime = datetime.now(),
    hello: int = 10,
    dt1: datetime = datetime.now(),
    hello1: int = 10,
    dt2: datetime = datetime.now(),
    hello2: int = 10,
    dt3: datetime = datetime.now(),
    hello4: int = 10,
    dt5: datetime = datetime.now(),
    hello5: int = 10,
    dt6: datetime = datetime.now(),
    hello6: int = 10,
    dt7: datetime = datetime.now(),
    hello7: int = 10,
    dt8: datetime = datetime.now(),
    hello8: int = 10,
    bool1: bool = True,
):
    chart = Chart()
    df = pd.read_csv(
        "/Users/jeonghoowon/dev/chart-server/sample/data/setting_data_ohlcv.csv"
    )
    chart.set(df)
    return chart
