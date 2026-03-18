@echo off
setlocal
call "%USERPROFILE%\.ccpoke\hooks\lib\common.cmd"
set TMPFILE=%TEMP%\ccpoke-%RANDOM%%RANDOM%.json
findstr "^" > %TMPFILE%
echo {}
if defined CCPOKE_PANE_ID (
  node "%USERPROFILE%\.ccpoke\hooks\lib\json-merge.cjs" "%TMPFILE%" "pane_id" "%CCPOKE_PANE_ID%"
)
curl.exe -s -X POST http://%CCPOKE_HOST%:%CCPOKE_PORT%/hook/session-start -H "Content-Type: application/json" -H "X-CCPoke-Secret: %CCPOKE_SECRET%" -d @%TMPFILE% > nul 2>&1
del %TMPFILE% > nul 2>&1
endlocal
