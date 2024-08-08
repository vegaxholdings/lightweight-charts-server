from pathlib import Path

import pandas as pd
from lightweight_charts import Chart
from lightweight_charts_server import View, Server

directory = Path(__file__).parent

df = pd.read_csv(directory / "ohlcv.csv")
chart = Chart(toolbox=True)
chart.set(df)

display = View(callback=lambda: chart)
server = Server(display)

if __name__ == "__main__":
    server.serve()
