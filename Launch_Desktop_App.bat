@echo off
title V2 Meet HD Desktop App
echo ========================================================
echo         Starting V2 Meet HD Desktop Application
echo ========================================================
echo.

cd /d "%~dp0"

:: Start backend Python server in background if not already running
netstat -ano | findstr :8000 >nul
if %errorlevel% neq 0 (
    echo [1/2] Starting V2 Meet Signaling Server on port 8000...
    start /b python backend\server.py
    timeout /t 2 /nobreak >nul
) else (
    echo [1/2] V2 Meet Signaling Server is already running on port 8000.
)

:: Launch Electron Desktop Window
echo [2/2] Launching Native Desktop App Window...
cd frontend
npm run electron

echo.
echo Application closed.
