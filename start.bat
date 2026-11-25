@echo off
setlocal
title Local AI Studio

rem ------------------------------------------------------------------
rem  Local AI Studio - one-click launcher (Windows)
rem    * builds the frontend into frontend\dist when it is missing,
rem      using the portable toolchain in .tools\node
rem    * starts the FastAPI backend (serves the build + the API)
rem    * opens http://127.0.0.1:8000 in the default browser
rem  One-time setup (backend venv, GAS_CHAT_DIR) is described in README.md.
rem ------------------------------------------------------------------

cd /d "%~dp0"

if "%LOCAL_AI_STUDIO_HOST%"=="" set "LOCAL_AI_STUDIO_HOST=127.0.0.1"
if "%LOCAL_AI_STUDIO_PORT%"=="" set "LOCAL_AI_STUDIO_PORT=8000"
set "APP_URL=http://%LOCAL_AI_STUDIO_HOST%:%LOCAL_AI_STUDIO_PORT%"

set "BACKEND_PY=%~dp0backend\.venv\Scripts\python.exe"
set "NODE_DIR=%~dp0.tools\node"
set "NPM_CMD=%NODE_DIR%\npm.cmd"

echo ============================================================
echo  Local AI Studio
echo  App:     %APP_URL%
echo  API doc: %APP_URL%/api/docs
echo ============================================================

rem ---- 1. backend virtualenv must exist -----------------------------
if not exist "%BACKEND_PY%" (
    echo.
    echo [ERROR] Backend virtualenv not found:
    echo         %BACKEND_PY%
    echo.
    echo One-time setup:
    echo     python -m venv backend\.venv
    echo     backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
    echo.
    pause
    exit /b 1
)

rem ---- 2. production frontend build (only when missing) -------------
if exist "frontend\dist\index.html" goto :start_backend

echo.
echo [build] frontend\dist is missing - building the frontend...

if not exist "%NPM_CMD%" (
    echo.
    echo [ERROR] Portable Node.js not found in .tools\node. Run once:
    echo     python scripts\setup_node.py
    echo ...and start this script again.
    echo.
    pause
    exit /b 1
)

set "PATH=%NODE_DIR%;%PATH%"

pushd frontend
if not exist "node_modules" (
    echo [build] installing frontend dependencies...
    call "%NPM_CMD%" install
    if errorlevel 1 (
        popd
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
)
echo [build] npm run build ...
call "%NPM_CMD%" run build
if errorlevel 1 (
    popd
    echo [ERROR] Frontend build failed
    pause
    exit /b 1
)
popd

if not exist "frontend\dist\index.html" (
    echo [ERROR] Build finished but frontend\dist\index.html is still missing
    pause
    exit /b 1
)

:start_backend

rem ---- 3. start the backend in a minimized window --------------------
echo.
echo [run] starting the backend on %APP_URL% ...
pushd backend
start "Local AI Studio - backend" /min "%BACKEND_PY%" run.py
popd
if errorlevel 1 (
    echo [ERROR] Could not start the backend
    pause
    exit /b 1
)

rem ---- 4. wait for /health, then open the default browser ------------
"%BACKEND_PY%" "%~dp0scripts\wait_and_open.py" "%APP_URL%"
if errorlevel 1 pause

echo.
echo Backend log: the minimized window "Local AI Studio - backend" (close it to stop).
endlocal
