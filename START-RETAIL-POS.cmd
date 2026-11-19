@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 24.14 or newer, then run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci
  if errorlevel 1 exit /b 1
)
echo DEMO MART - Retail and wholesale POS
if not exist dist\index.html (
  call npm run build
  if errorlevel 1 exit /b 1
)
echo Open http://localhost:4175 in your browser.
echo Keep this window open while using the local site.
node scripts\preview.mjs
