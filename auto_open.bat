@echo off
rem Hourly auto check (only lines starting with http are opened) - opens product pages with #autotrack
rem Tampermonkey saves each tab result locally and closes the tab by itself
rem Only the URL part is opened. Unit notes after a space (like 2 or 9 sheet notes, 20cm) are for the dashboard only
rem After all tabs, the dashboard #flush page uploads everything to GitHub at once
cd /d "%~dp0"
rem Night (00:00 to 05:59): full check only every 2 hours (runs at 0, 2, 4 o'clock, skips 1, 3, 5)
for /f %%h in ('powershell -NoProfile -Command "(Get-Date).Hour"') do set HH=%%h
if "%HH%"=="1" exit
if "%HH%"=="3" exit
if "%HH%"=="5" exit
for /f "usebackq tokens=1" %%u in (`findstr /b /i "http" "products.txt"`) do (
  start "" "chrome.exe" "%%u#autotrack"
  timeout /t 6 /nobreak >nul
)
rem wait for the last tabs to finish, then open the upload page
timeout /t 30 /nobreak >nul
start "" "chrome.exe" "https://ds4eqm-lgtm.github.io/competitor-stock/#flush"
exit
