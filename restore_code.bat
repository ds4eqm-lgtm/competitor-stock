@echo off
rem ============================================================
rem  Roll back program files to the last restore point (tag: stable)
rem  Sales data (data folder) and products.txt are NOT touched
rem  Use when the dashboard or auto check broke after a change
rem ============================================================
cd /d "%~dp0"
if not exist ".git" goto NOGIT
echo [1/4] Getting restore points from GitHub
git fetch origin --tags --force
git fetch origin
echo [2/4] Restore point info:
git log -1 --format="  %%h  %%ad  %%s" --date=format:"%%Y-%%m-%%d %%H:%%M" stable
echo.
choice /m "Roll back program files to this restore point"
if errorlevel 2 goto CANCEL
git pull origin main --no-rebase --no-edit
echo [3/4] Restoring program files
git checkout stable -- index.html auto_open.bat auto_register.bat auto_status.bat auto_stop.bat products_upload.bat shutdown_register.bat shutdown_stop.bat backup
git commit -m "restore program files to restore point (stable)" -- index.html auto_open.bat auto_register.bat auto_status.bat auto_stop.bat products_upload.bat shutdown_register.bat shutdown_stop.bat backup
echo [4/4] Uploading
git push origin main
echo.
echo DONE. If the Tampermonkey script was also changed, reinstall it from backup\tampermonkey_tracker.user.js
pause
exit /b
:CANCEL
echo Cancelled. Nothing changed.
pause
exit /b
:NOGIT
echo ERROR: Put this file inside competitor-stock folder.
pause
