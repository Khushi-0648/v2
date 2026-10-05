@echo off
title V2 Development Environment
echo Starting Python Backend...
start cmd /k "cd /d "%~dp0backend" && python server.py"
echo Starting Vite Frontend...
start cmd /k "cd /d "%~dp0frontend" && npm run dev"
echo Development servers started!
