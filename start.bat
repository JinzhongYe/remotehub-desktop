@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :missing_node

node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major<22 || (major===22 && minor<12) ? 1 : 0)" >nul 2>nul
if errorlevel 1 goto :old_node

where npm >nul 2>nul
if errorlevel 1 goto :missing_npm

if not exist "node_modules\.bin\electron.cmd" goto :install_dependencies
if not exist "node_modules\serialport\package.json" goto :install_dependencies
if not exist "node_modules\mysql2\package.json" goto :install_dependencies
if not exist "node_modules\electron-builder\package.json" goto :install_dependencies
goto :dependencies_ready

:install_dependencies
echo Installing or updating dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 goto :install_failed

:dependencies_ready

echo Starting RemoteHub Desktop...
call npm run dev
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo The app stopped with exit code %EXIT_CODE%.
  pause
)
exit /b %EXIT_CODE%

:missing_node
echo Node.js 22.12 or newer is required for source builds. Install it from https://nodejs.org/ or download a ready-to-run release.
pause
exit /b 1

:old_node
echo The installed Node.js version is too old. Please install Node.js 22.12 or newer, or download a ready-to-run release.
pause
exit /b 1

:missing_npm
echo npm was not found. Reinstall Node.js 22.12 or newer with npm included.
pause
exit /b 1

:install_failed
echo Dependency installation failed. Check your network connection, C++ runtime, and run start.bat again.
pause
exit /b 1
