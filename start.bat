@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :missing_node

node -e "process.exit(Number(process.versions.node.split('.')[0]) < 20 ? 1 : 0)" >nul 2>nul
if errorlevel 1 goto :old_node

where npm >nul 2>nul
if errorlevel 1 goto :missing_npm

if not exist "node_modules\.bin\electron.cmd" (
  echo Installing dependencies for the first run...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :install_failed
)

echo Starting RemoteHub Desktop...
call npm run dev
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo The app stopped with exit code %EXIT_CODE%.
  pause
)
exit /b %EXIT_CODE%

:missing_node
echo Node.js 20 or newer is required. Install it from https://nodejs.org/ and run this file again.
pause
exit /b 1

:old_node
echo The installed Node.js version is too old. Please install Node.js 20 or newer from https://nodejs.org/.
pause
exit /b 1

:missing_npm
echo npm was not found. Reinstall Node.js 20 or newer with npm included.
pause
exit /b 1

:install_failed
echo Dependency installation failed. Check your network connection and run start.bat again.
pause
exit /b 1
