import os
import sys
import platform
import subprocess
import multiprocessing

xvfb_error_message = """ 
Error: Xvfb is not installed or unavailable!

Please set up the Xvfb environment by installing the necessary packages using the following commands:

# Install Xvfb
apt install -y xvfb

# Install GTK (GUI Toolkit)
apt install -y python3-gi libgtk-3-dev gir1.2-webkit2-4.1

# Install the package that binds GTK to Python
apt install -y libgirepository1.0-dev 
pip install pygobject
"""

if platform.system() == "Linux" and not os.environ.get("DISPLAY"):
    try:
        subprocess.run(["xvfb-run", "-a", "python"] + sys.argv)
    except FileNotFoundError:
        print(xvfb_error_message)
    finally:
        sys.exit()

if multiprocessing.get_start_method() != "spawn":
    # If use Xvfb, All child processors must inherit the Xvfb context.
    multiprocessing.set_start_method("spawn", force=True)


from lightweight_charts_server.server import Server
from lightweight_charts_server.display import View, Stream
from lightweight_charts_server.system import log
