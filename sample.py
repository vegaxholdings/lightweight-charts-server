from sample.functions.setting_data import make_chart

from src import Server


if __name__ == "__main__":
    server = Server(make_chart)
    server.serve()
