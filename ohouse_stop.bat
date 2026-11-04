@echo off
echo Removing hourly task: OhouseStockHourly
schtasks /delete /tn "OhouseStockHourly" /f
pause
