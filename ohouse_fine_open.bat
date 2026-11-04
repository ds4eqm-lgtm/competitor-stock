@echo off
rem Ohouse 10-minute check - opens ONE store.ohou.se tab with #ohcollect-fine
rem Tampermonkey reads only doden products (brand list is FINE_STORES in the Ohouse script) and uploads changes to ohouse/data/history_fine.json
rem Night (00:00 to 05:59): no 10-minute check
for /f %%h in ('powershell -NoProfile -Command "(Get-Date).Hour"') do set HH=%%h
if %HH% LSS 6 exit
start "" "chrome.exe" "https://store.ohou.se/#ohcollect-fine"
exit
