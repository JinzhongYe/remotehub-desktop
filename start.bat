@echo off
setlocal
cd /d "%~dp0"
set "PNPM=pnpm"

where pnpm >nul 2>nul
if not errorlevel 1 goto run

where corepack >nul 2>nul
if errorlevel 1 (
  echo 未找到 pnpm 或 corepack，请先安装 Node.js 20+。
  pause
  exit /b 1
)

set "PNPM=corepack pnpm"
echo 正在通过 corepack 准备 pnpm...
call corepack pnpm --version >nul 2>nul
if errorlevel 1 (
  echo pnpm 准备失败，请检查网络或手动安装 pnpm。
  pause
  exit /b 1
)

:run
if not exist node_modules (
  echo 首次运行，正在安装依赖...
  call %PNPM% install
  if errorlevel 1 (
    echo 依赖安装失败。
    pause
    exit /b 1
  )
)

call %PNPM% dev
if errorlevel 1 pause
