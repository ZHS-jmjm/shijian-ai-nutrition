@echo off
setlocal
chcp 65001 >nul
title 食鉴 · AI 营养分析师
echo ============================================
echo   食鉴 · AI 营养分析师  一键启动
echo ============================================

rem 优先使用项目内的 Node.js，其次使用原比赛包或系统中的 Node.js。
if exist "%~dp0..\..\02_runtime\nodejs\node.exe" set "PATH=%~dp0..\..\02_runtime\nodejs;%PATH%"
if exist "%~dp0.runtime\node\node.exe" set "PATH=%~dp0.runtime\node;%PATH%"

where /q node
if errorlevel 1 (
  echo 找不到 Node.js。请安装 Node.js 后重试。
  pause
  exit /b 1
)

cd /d "%~dp0server" || exit /b 1

if not exist "node_modules\express\package.json" goto install
if not exist "node_modules\mysql2\package.json" goto install
goto run

:install
where /q npm
if errorlevel 1 (
  echo 找不到 npm。请安装包含 npm 的 Node.js 后重试。
  pause
  exit /b 1
)
echo 正在按锁定版本安装依赖...
call npm ci --no-fund
if errorlevel 1 (
  echo 依赖安装失败，请查看上方错误，解决后重试。
  pause
  exit /b 1
)

:run
echo 正在启动食鉴服务...
if /i "%~1"=="--no-browser" (
  node server.js
) else (
  node server.js --open
)
if errorlevel 1 (
  echo 服务启动失败，请查看上方错误和使用说明。
  pause
  exit /b 1
)
