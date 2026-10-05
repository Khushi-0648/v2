"""
V2 Desktop Launcher
Runs the local zero-knowledge FastAPI server and opens a high-performance,
minimal-resource Windows native window using Microsoft Edge WebView2.
"""

import os
import sys
import time
import urllib.request
import threading
import subprocess
import webview

SERVER_PORT = 8000
SERVER_URL = f"http://127.0.0.1:{SERVER_PORT}"
HEALTH_URL = f"{SERVER_URL}/health"

def is_server_running():
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=1) as response:
            return response.status == 200
    except Exception:
        return False

def start_backend():
    server_script = os.path.join(os.path.dirname(__file__), "backend", "server.py")
    proc = subprocess.Popen(
        [sys.executable, server_script],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    return proc

def main():
    backend_proc = None

    if not is_server_running():
        print(f"[*] Starting V2 Zero-Knowledge Signaling Server on {SERVER_URL}...")
        backend_proc = start_backend()

        # Wait up to 5 seconds for server to boot
        for _ in range(25):
            time.sleep(0.2)
            if is_server_running():
                print("[+] Server ready.")
                break
        else:
            print("[!] Warning: Server took longer than expected to report healthy.")
    else:
        print("[+] Existing V2 server detected on port 8000.")

    print("[*] Launching V2 Desktop Window (WebView2 EdgeChromium)...")

    # Native desktop window
    window = webview.create_window(
        title="V2 - Zero-Knowledge E2EE Video Conferencing",
        url=SERVER_URL,
        width=1120,
        height=760,
        min_size=(800, 600),
        resizable=True,
        background_color="#0b0f19"
    )

    try:
        # gui="edgechromium" uses native Windows WebView2 for lowest RAM and GPU video acceleration
        webview.start(gui="edgechromium", debug=False)
    finally:
        if backend_proc:
            print("[*] Shutting down backend server...")
            backend_proc.terminate()
            try:
                backend_proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                backend_proc.kill()
        print("[+] V2 session closed safely.")

if __name__ == "__main__":
    main()
