@echo off
cd /d "%~dp0"
echo Registering 10-minute task: OhouseStockFine (runs at minute 08, 18, 28, 38, 48, 58)
schtasks /create /tn "OhouseStockFine" /sc minute /mo 10 /st 00:08 /tr "\"%~dp0ohouse_fine_open.bat\"" /f
if %ERRORLEVEL% EQU 0 (
  echo.
  echo OK. Ohouse doden check runs every 10 minutes from 06:00 to 23:59.
  echo Test now: schtasks /run /tn "OhouseStockFine"
) else (
  echo.
  echo Failed. Right-click this file and choose Run as administrator.
)
pause
