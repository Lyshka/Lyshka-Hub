@echo off
cd /d "%~dp0"
start "" /min cmd /c "call npm --prefix connector install --no-audit --no-fund && call npm run cs2:connector"
