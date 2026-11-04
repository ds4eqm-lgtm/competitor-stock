@echo off
echo Removing 10-minute task: OhouseStockFine
schtasks /delete /tn "OhouseStockFine" /f
pause
