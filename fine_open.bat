@echo off
rem 10-minute check for selected stores only (default: doden)
rem Opens only matching links with #autotrack-fine, then the #flushfine page uploads to data/history_fine.json
rem To add another store, add its address word to FINE_MATCH separated by space, e.g. set FINE_MATCH=doden/products arving/products
set FINE_MATCH=doden/products
cd /d "%~dp0"
rem Night (00:00 to 05:59): no 10-minute check
for /f %%h in ('powershell -NoProfile -Command "(Get-Date).Hour"') do set HH=%%h
if %HH% LSS 6 exit
for /f "usebackq tokens=1" %%u in (`findstr /b /i "http" "products.txt" ^| findstr /i "%FINE_MATCH%"`) do (
  start "" "chrome.exe" "%%u#autotrack-fine"
  timeout /t 4 /nobreak >nul
)
timeout /t 15 /nobreak >nul
start "" "chrome.exe" "https://ds4eqm-lgtm.github.io/competitor-stock/#flushfine"
exit
