@echo off
title V2 Meet HD - Cloudflare Live Tunnel
cd /d "%~dp0"
echo =======================================================
echo    V2 Meet HD - Cloudflare Tunnel Starter
echo =======================================================
echo.

REM 1. Check if backend is already running on port 8000
netstat -ano | findstr :8000 | findstr LISTENING >nul
if %errorlevel% neq 0 (
    echo [*] Starting Python Backend on http://127.0.0.1:8000...
    start /b python backend\server.py
    timeout /t 3 /nobreak >nul
) else (
    echo [*] Backend is already running on http://127.0.0.1:8000.
)

REM 2. Launch Cloudflare Tunnel
echo.
echo [*] Connecting to Cloudflare Global Edge Network...
echo [*] Your public HTTPS link will appear below:
echo -------------------------------------------------------
.\cloudflared.exe tunnel --url http://127.0.0.1:8000
pause
