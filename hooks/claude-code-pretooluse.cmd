@echo off
setlocal
call "%USERPROFILE%\.ccpoke\hooks\lib\common.cmd"
set TMPFILE=%TEMP%\ccpoke-%RANDOM%%RANDOM%.json
findstr "^" > %TMPFILE%
for /f "tokens=*" %%t in ('node "%USERPROFILE%\.ccpoke\hooks\lib\json-read.cjs" "%TMPFILE%" "tool_name"') do set TOOL_NAME=%%t
if /i not "%TOOL_NAME%"=="AskUserQuestion" (del %TMPFILE% > nul 2>&1 & endlocal & exit /b 0)
for /f "tokens=*" %%s in ('node "%USERPROFILE%\.ccpoke\hooks\lib\json-read.cjs" "%TMPFILE%" "session_id"') do set SESSION_ID=%%s
if not defined SESSION_ID (del %TMPFILE% > nul 2>&1 & endlocal & exit /b 0)
if defined CCPOKE_PANE_ID (
  node "%USERPROFILE%\.ccpoke\hooks\lib\json-merge.cjs" "%TMPFILE%" "pane_id" "%CCPOKE_PANE_ID%"
)
curl.exe -s -X POST http://%CCPOKE_HOST%:%CCPOKE_PORT%/hook/ask-user-question -H "Content-Type: application/json" -H "X-CCPoke-Secret: %CCPOKE_SECRET%" -d @%TMPFILE% > nul 2>&1
del %TMPFILE% > nul 2>&1
endlocal
