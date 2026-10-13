@echo off
rem Hourly auto check (only lines starting with http are opened) - opens product pages with #autotrack
rem Tampermonkey saves each tab result locally and closes the tab by itself
rem Only the URL part is opened. Unit notes after a space (like 2 or 9 sheet notes, 20cm) are for the dashboard only
rem After all tabs, the dashboard #flush page uploads everything to GitHub at once
cd /d "%~dp0"
for /f "usebackq tokens=1" %%u in (`findstr /b /i "http" "products.txt"`) do (
  start "" "chrome.exe" "%%u#autotrack"
  timeout /t 6 /nobreak >nul
)
rem wait for the last tabs to finish, then open the upload page
timeout /t 30 /nobreak >nul
start "" "chrome.exe" "https://yongki9156.github.io/competitor-stock/#flush"
exit
