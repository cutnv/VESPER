@echo off
setlocal
set "ELECTRON_CACHE=%~dp0cache\electron"
set "TEMP=%~dp0temp"
set "TMP=%~dp0temp"
set "ELECTRON_RUN_AS_NODE="
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
