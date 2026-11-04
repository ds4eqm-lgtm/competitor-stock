@echo off
cd /d "%~dp0"
echo Registering hourly task: OhouseStockHourly
schtasks /create /tn "OhouseStockHourly" /sc hourly /mo 1 /st 00:03 /tr "\"%~dp0ohouse_open.bat\"" /f
if %ERRORLEVEL% EQU 0 (
  echo.
  echo OK. Ohouse check runs at minute 03 of every hour, 24 hours.
  echo Test now: schtasks /run /tn "OhouseStockHourly"
) else (
  echo.
  echo Failed. Right-click this file and choose Run as administrator.
)
pause
