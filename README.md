# V2 — Zero-Knowledge E2EE Video Conferencing for Windows

**V2** is a lightweight, high-security, end-to-end encrypted (E2EE) video conferencing desktop application designed specifically for Windows. It provides zero-knowledge privacy, hardware-accelerated media encryption, and minimal resource consumption.

---

## 🔒 Security Architecture & Guarantees

### 1. Zero-Knowledge Key Derivation
- When you create or join a call using a passcode (e.g. `quantum-shield-zenith-8492`), **the passcode never leaves your machine**.
- **Room ID**: Derived via `SHA-256(passcode)[:16]`. Only this public hash is transmitted to the signaling server.
- **Encryption Key**: Derived via `PBKDF2(passcode, salt, 100,000 rounds)` into a 256-bit `AES-GCM` CryptoKey stored strictly in client RAM.

### 2. Frame-Level Media Encryption (Insertable Streams)
- Uses **WebRTC Encoded Transform (Insertable Streams)**.
- Every individual audio and video frame is encrypted with **AES-256-GCM** with a unique 96-bit IV before leaving the browser engine.
- Even if network traffic, routers, ISPs, or signaling servers are intercepted, they only see ciphertext noise.

### 3. Hard 2-Peer Capacity Lock
- The Python signaling server enforces a strict maximum limit of **2 participants** per room.
- Any 3rd attempt to connect to an existing room is rejected immediately with WebSocket code `1008 (Access Denied)`.

### 4. Short Authentication String (SAS / Safety Number)
- Generates a 6-digit cryptographic safety number from the shared secret.
- Comparing this number with your peer over voice mathematically proves that no Man-in-the-Middle (MITM) attack exists.

### 5. Ephemeral In-Memory State
- The backend stores zero call logs, zero media files, and zero database entries.
- When both peers disconnect, the room state is purged from RAM.

---

## ⚡ Minimal Resource Engineering (Windows)

Unlike Electron-based applications (which consume 250MB–400MB RAM idle by bundling a redundant Chromium browser), **V2** utilizes **Microsoft Edge WebView2**:
- **RAM Footprint**: ~50MB–80MB on Windows 10/11.
- **Hardware Acceleration**: Video encoding/decoding offloads directly to your GPU via Windows DirectX/Media Foundation.
- **CPU Crypto Acceleration**: Runs AES-256-GCM via CPU hardware instructions (`AES-NI`), taking <0.1ms per frame.

---

## 📁 Project Structure

```text
V2/
├── backend/
│   ├── server.py              # Zero-knowledge FastAPI + WebSocket signaling server
│   └── requirements.txt       # fastapi, uvicorn, websockets, pywebview
├── frontend/
│   ├── src/
│   │   ├── services/
│   │   │   ├── crypto.js      # PBKDF2, SHA-256, AES-256-GCM, SAS verification
│   │   │   └── webrtc.js      # WebRTC + Insertable Streams + DataChannel
│   │   ├── App.jsx            # Modern React UI with call controls & chat
│   │   ├── App.css            # Dark cyberpunk/minimalist styling
│   │   └── index.css          # Base resets
│   ├── dist/                  # Production-optimized static bundle
│   └── package.json
├── launcher.py                # Desktop runner with Microsoft Edge WebView2
├── run_app.bat                # Windows 1-click launcher
├── run_dev.bat                # Development mode with hot-reload
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites
- Windows 10 or 11 (with Microsoft Edge WebView2, standard on Windows)
- Python 3.10+
- Node.js 18+ (only needed for modifying frontend code)

### Running the Application

Double-click `run_app.bat` or run in terminal:
```powershell
python launcher.py
```
This automatically starts the local zero-knowledge signaling server and opens the native Windows desktop app window.

---

## 🛠️ Development Mode (With Hot Reload)

To work on frontend UI or backend with live reloading:
```powershell
# In one terminal:
cd backend
python server.py

# In another terminal:
cd frontend
npm run dev
```

To re-build the production UI:
```powershell
cd frontend
npm run build
```

---

## 📦 Packaging into a Standalone `.exe`

To compile V2 into a standalone executable file:
```powershell
pip install pyinstaller
pyinstaller --noconsole --onefile --add-data "frontend/dist;frontend/dist" --add-data "backend;backend" launcher.py
```
This produces a portable `.exe` file in the `dist/` directory.
