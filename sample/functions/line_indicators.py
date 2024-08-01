import pandas as pd
from lightweight_charts import Chart


def calculate_sma(df, period: int = 50):
    return pd.DataFrame(
        {"time": df["date"], f"SMA {period}": df["close"].rolling(window=period).mean()}
    ).dropna()


def make_chart():
    df = pd.read_csv("sample/line_indicators_ohlcv.csv")
    sma_data = calculate_sma(df, period=50)

    chart = Chart()
    chart.legend(visible=True)
    chart.set(df)

    line = chart.create_line("SMA 50")
    line.set(sma_data)
    return chart
