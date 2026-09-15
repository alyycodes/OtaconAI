@echo off
setlocal
title OtaconAI launcher
cd /d "%~dp0"

echo.
echo   ====================================
echo    OtaconAI - starting up
echo   ====================================
echo.

REM ---- checks -------------------------------------------------------------

set "PY="
where python >nul 2>&1 && set "PY=python"
if not defined PY (
  py --version >nul 2>&1 && set "PY=py"
)
if not defined PY (
  echo  [X] Python is not installed or not on PATH.
  echo      Get it from https://python.org and tick "Add to PATH".
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo  [X] Node.js is not installed or not on PATH.
  echo      Get it from https://nodejs.org
  pause
  exit /b 1
)

if not exist "backend\.env" (
  echo  [X] backend\.env is missing.
  echo      Create it with one line:  GEMINI_API_KEY=your-key-here
  pause
  exit /b 1
)

REM ---- backend setup ------------------------------------------------------

if not exist "backend\venv\Scripts\python.exe" (
  echo  [1/3] Creating Python virtual environment...
  %PY% -m venv backend\venv
  if errorlevel 1 (
    echo  [X] Could not create the virtual environment.
    pause
    exit /b 1
  )
) else (
  echo  [1/3] Virtual environment found.
)

echo  [2/3] Installing Python packages...
call backend\venv\Scripts\python.exe -m pip install --quiet --upgrade pip
call backend\venv\Scripts\python.exe -m pip install --quiet -r backend\requirements.txt
if errorlevel 1 (
  echo  [X] Python packages failed to install.
  pause
  exit /b 1
)

REM ---- frontend setup -----------------------------------------------------

if not exist "frontend\node_modules" (
  echo  [3/3] Installing Node packages ^(first run, this takes a few minutes^)...
  pushd frontend
  call npm install --silent
  popd
  if errorlevel 1 (
    echo  [X] npm install failed.
    pause
    exit /b 1
  )
) else (
  echo  [3/3] Node packages found.
)

REM ---- launch -------------------------------------------------------------

echo.
echo   Starting both servers in their own windows...
echo   Close those windows to stop OtaconAI.
echo.

start "OtaconAI backend" cmd /k "cd /d "%~dp0backend" && venv\Scripts\activate && uvicorn main:app --reload --port 8000"

REM Give uvicorn a moment so the UI does not flash "offline" on first paint.
timeout /t 4 /nobreak >nul

start "OtaconAI frontend" cmd /k "cd /d "%~dp0frontend" && npm start"

echo   Backend:  http://127.0.0.1:8000/api/health
echo   App:      http://localhost:3000
echo.
echo   This window can be closed.
timeout /t 8 /nobreak >nul
endlocal
