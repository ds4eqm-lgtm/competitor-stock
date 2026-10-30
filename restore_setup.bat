@echo off
rem ============================================================
rem  New PC setup (or full reinstall) for competitor-stock
rem  1. Install Git for Windows first: https://git-scm.com
rem  2. Download only this file to the Desktop and double click
rem ============================================================
cd /d "%USERPROFILE%\Desktop"
where git >nul 2>nul
if errorlevel 1 goto NOGIT
if exist "competitor-stock\.git" (
  echo [1/4] Folder already exists, getting latest from GitHub
  cd competitor-stock
  git pull origin main --no-rebase --no-edit
) else (
  echo [1/4] Downloading competitor-stock from GitHub
  git clone https://github.com/ds4eqm-lgtm/competitor-stock.git
  if errorlevel 1 goto FAIL
  cd competitor-stock
)
echo [2/4] Registering hourly auto check
schtasks /create /tn "CompetitorStockHourly" /sc hourly /mo 1 /st 00:01 /tr "\"%cd%\auto_open.bat\"" /f
echo [3/4] 24-hour mode: no auto shutdown, no sleep
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
echo [4/4] Opening Tampermonkey script backup folder
explorer "%cd%\backup"
echo.
echo DONE. Next: follow steps in backup\RESTORE_GUIDE.txt (Tampermonkey part)
pause
exit /b
:NOGIT
echo ERROR: Git is not installed. Install from https://git-scm.com then run again.
start "" "https://git-scm.com/download/win"
pause
exit /b
:FAIL
echo ERROR: Download failed. Check internet and run again.
pause
