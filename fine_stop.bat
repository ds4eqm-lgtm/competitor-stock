@echo off
echo Removing 10-minute task: CompetitorStockFine
schtasks /delete /tn "CompetitorStockFine" /f
pause
