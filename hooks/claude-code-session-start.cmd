@echo off
setlocal
call "%USERPROFILE%\.ccpoke\hooks\lib\common.cmd"
if not defined TMUX (endlocal & exit /b 0)
set TMPFILE=%TEMP%\ccpoke-%RANDOM%%RANDOM%.json
findstr "^" > %TMPFILE%
for /f "tokens=*" %%s in ('node "%USERPROFILE%\.ccpoke\hooks\lib\json-read.cjs" "%TMPFILE%" "session_id"') do set SESSION_ID=%%s
if not defined SESSION_ID (del %TMPFILE% > nul 2>&1 & endlocal & exit /b 0)
for /f "tokens=*" %%c in ('node "%USERPROFILE%\.ccpoke\hooks\lib\json-read.cjs" "%TMPFILE%" "cwd"') do set CWD_VAL=%%c
set PAYLOAD={"session_id":"%SESSION_ID%","cwd":"%CWD_VAL%","pane_id":"%CCPOKE_PANE_ID%"}
curl.exe -s -X POST http://%CCPOKE_HOST%:%CCPOKE_PORT%/hook/session-start -H "Content-Type: application/json" -H "X-CCPoke-Secret: %CCPOKE_SECRET%" -d "%PAYLOAD%" > nul 2>&1
del %TMPFILE% > nul 2>&1
endlocal
