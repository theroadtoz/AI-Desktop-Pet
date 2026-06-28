@echo off
setlocal

title AI Desktop Pet

pushd "%~dp0" || (
  echo Failed to enter the project directory.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo package.json was not found in "%CD%".
  echo Please run this launcher from the AI Desktop Pet project folder.
  popd
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm.cmd was not found. Please install Node.js and npm, then try again.
  popd
  pause
  exit /b 1
)

echo Starting AI Desktop Pet from "%CD%"...
echo Running: npm.cmd run dev
echo.

npm.cmd run dev
set "EXIT_CODE=%ERRORLEVEL%"

popd

if not "%EXIT_CODE%"=="0" (
  echo.
  echo AI Desktop Pet exited with code %EXIT_CODE%.
  pause
)

exit /b %EXIT_CODE%
