@echo off
rem Run once on the collector PC after the repository moved to ds4eqm-lgtm
rem Points this folder to the new GitHub address and gets the latest files
cd /d "%~dp0"
if not exist ".git" goto NOGIT
echo [1/3] Old address:
git remote get-url origin
git remote set-url origin https://github.com/ds4eqm-lgtm/competitor-stock.git
echo [2/3] New address:
git remote get-url origin
echo [3/3] Getting latest files from the new address
git pull origin main --no-rebase --no-edit
echo.
echo DONE. If a GitHub login window appears later, sign in as ds4eqm-lgtm.
pause
exit /b
:NOGIT
echo ERROR: Put this file inside competitor-stock folder.
pause
