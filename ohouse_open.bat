@echo off
rem Ohouse hourly check - opens ONE store.ohou.se tab with #ohcollect
rem Tampermonkey (Ohouse tracker) reads ohouse/products.txt from GitHub, reads stock of each product, uploads to ohouse/data, then closes the tab
rem Independent from the Naver check (different site, different data folder)
start "" "chrome.exe" "https://store.ohou.se/#ohcollect"
exit
