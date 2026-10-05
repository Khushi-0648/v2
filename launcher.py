"""
V2 Desktop Application Launcher
Zero-Knowledge E2EE Video Conferencing
Bundles local FastAPI backend & native Windows WebView2 window into a single standalone process.
"""

import os
import sys
import time
import socket
import urllib.request
import threading
import webbrowser
import logging

# Ensure frozen bundle search paths
if getattr(sys, "frozen", False):
    bundle_dir = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    sys.path.insert(0, bundle_dir)
    sys.path.insert(0, os.path.join(bundle_dir, "backend"))
else:
    root_dir = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, root_dir)
    sys.path.insert(0, os.path.join(root_dir, "backend"))

# File logging for non-console troubleshooting
log_path = os.path.join(os.path.expanduser("~"), "v2_desktop.log")
logging.basicConfig(
    filename=log_path,
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("V2-Launcher")

import uvicorn
from backend.server import app

DEFAULT_PORT = 8000

def is_v2_server(port: int) -> bool:
    """Checks whether an existing V2 instance is responding on this port."""
    try:
        url = f"http://127.0.0.1:{port}/health"
        with urllib.request.urlopen(url, timeout=0.8) as response:
            return response.status == 200
    except Exception:
        return False

def find_free_port(start_port: int = 8000) -> int:
    """Finds an available local TCP port."""
    for port in range(start_port, start_port + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return start_port

def run_inprocess_server(port: int):
    """Runs the FastAPI server inside a background daemon thread."""
    try:
        config = uvicorn.Config(
            app,
            host="127.0.0.1",
            port=port,
            log_level="error",
            access_log=False
        )
        server = uvicorn.Server(config)
        server.run()
    except Exception as e:
        logger.error(f"Uvicorn server crashed: {e}", exc_info=True)

def main():
    logger.info("V2 Desktop starting up...")
    target_port = DEFAULT_PORT

    if is_v2_server(DEFAULT_PORT):
        logger.info(f"Connecting to existing V2 server on port {DEFAULT_PORT}...")
    else:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            port_busy = s.connect_ex(("127.0.0.1", DEFAULT_PORT)) == 0

        if port_busy:
            target_port = find_free_port(8001)

        logger.info(f"Starting in-process V2 secure engine on http://127.0.0.1:{target_port}...")
        server_thread = threading.Thread(
            target=run_inprocess_server,
            args=(target_port,),
            daemon=True
        )
        server_thread.start()

        for _ in range(35):
            time.sleep(0.2)
            if is_v2_server(target_port):
                logger.info(f"V2 engine online on port {target_port}.")
                break
        else:
            logger.warning("V2 engine took longer than expected to report healthy.")

    app_url = f"http://127.0.0.1:{target_port}"

    # Try launching native WebView2 desktop window
    try:
        import webview

        # Locate icon if present
        icon_path = None
        if getattr(sys, "frozen", False):
            base_dir = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
            cand = os.path.join(base_dir, "app.ico")
            if os.path.exists(cand):
                icon_path = cand
        else:
            cand = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app.ico")
            if os.path.exists(cand):
                icon_path = cand

        window = webview.create_window(
            title="V2 - Zero-Knowledge E2EE Video Conferencing",
            url=app_url,
            width=1240,
            height=820,
            min_size=(900, 640),
            resizable=True,
            background_color="#ffffff"
        )

        logger.info("Opening V2 Desktop Window (WebView2 EdgeChromium)...")
        webview.start(gui="edgechromium", debug=False)
        logger.info("V2 Desktop window closed.")

    except Exception as e:
        logger.warning(f"Native WebView2 failed ({e}), opening default web browser...")
        webbrowser.open(app_url)
        try:
            while True:
                time.sleep(1)
        except (KeyboardInterrupt, SystemExit):
            pass

if __name__ == "__main__":
    main()
