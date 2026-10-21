@echo off
cd /d "%~dp0"
echo Registering 10-minute task: CompetitorStockFine (runs at minute 05, 15, 25, 35, 45, 55)
schtasks /create /tn "CompetitorStockFine" /sc minute /mo 10 /st 00:05 /tr "\"%~dp0fine_open.bat\"" /f
if %ERRORLEVEL% EQU 0 (
  echo.
  echo OK. Selected store pages will open every 10 minutes.
) else (
  echo.
  echo Failed. Right-click this file and choose Run as administrator.
)
pause
