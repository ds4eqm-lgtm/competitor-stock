@echo off
rem ============================================================
rem  24-hour mode for the collector PC
rem  - removes the daily 18:10 auto shutdown
rem  - stops Windows from sleeping or hibernating (screen can still turn off)
rem  - makes sure the hourly auto check is registered
rem ============================================================
cd /d "%~dp0"
echo [1/4] Removing daily auto shutdown
schtasks /delete /tn "CompetitorStockShutdown" /f
shutdown /a >nul 2>&1
echo.
echo [2/4] Turning off sleep and hibernate (plugged in)
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 30
echo.
echo [3/4] Checking hourly auto check
schtasks /query /tn "CompetitorStockHourly" >nul 2>&1
if errorlevel 1 (
  echo Hourly task missing, registering again
  schtasks /create /tn "CompetitorStockHourly" /sc hourly /mo 1 /st 00:01 /tr "\"%~dp0auto_open.bat\"" /f
) else (
  echo Hourly task OK
)
echo.
echo [4/4] Current status
schtasks /query /tn "CompetitorStockShutdown" >nul 2>&1
if errorlevel 1 (echo Auto shutdown : OFF) else (echo Auto shutdown : STILL ON - right-click this file, Run as administrator)
powershell -NoProfile -Command "$i = Get-ScheduledTask -TaskName 'CompetitorStockHourly' -ErrorAction SilentlyContinue | Get-ScheduledTaskInfo; if ($i) { 'Hourly check : ON, next run ' + $i.NextRunTime } else { 'Hourly check : OFF' }"
echo.
echo DONE. Keep this PC logged in (screen lock is OK). Chrome must stay open.
pause
