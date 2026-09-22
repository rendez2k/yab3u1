@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo.
    echo   Python was not found on your PATH.
    echo   Install it from https://www.python.org/downloads/
    echo   and tick "Add python.exe to PATH" during setup.
    echo.
    pause
    exit /b 1
)

echo Starting the 3MF to Snapmaker U1 converter...
echo Close this window (or press Ctrl+C) when you are finished.
echo.
python u1ui.py %*
if errorlevel 1 pause
endlocal
