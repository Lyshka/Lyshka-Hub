@echo off
cd /d "%~dp0"
start "" /min cmd /c "npm --prefix connector install --no-audit --no-fund && npm run cs2:connector"
