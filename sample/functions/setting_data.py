import pandas as pd
import lightweight_charts_server
from lightweight_charts import Chart
from lightweight_charts_server import Server

from datetime import datetime


def calculate_sma(df, period: int = 50):
    return pd.DataFrame(
        {"time": df["date"], f"SMA {period}": df["close"].rolling(window=period).mean()}
    ).dropna()


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
    한글: int = 10,
    dt6: datetime = datetime.now(),
    hello6: int = 10,
    dt7: datetime = datetime.now(),
    hello7: int = 10,
    dt8: datetime = datetime.now(),
    hello8_from_hello: int = 10,
    bool1: bool = True,
    make_sma: bool = False,
):
    chart = Chart()
    if not make_sma:
        df = pd.read_csv(
            "/Users/jeonghoowon/dev/lightweight-charts-server/sample/data/setting_data_ohlcv.csv"
        )
        chart.set(df)
    else:
        df = pd.read_csv(
            "/Users/jeonghoowon/dev/lightweight-charts-server/sample/data/line_indicators_ohlcv.csv"
        )
        sma_data = calculate_sma(df, period=50)

        chart.legend(visible=True)
        chart.set(df)

        line = chart.create_line("SMA 50")
        line.set(sma_data)
        return chart

    return chart


if __name__ == "__main__":
    Server(callback=make_chart).serve()
