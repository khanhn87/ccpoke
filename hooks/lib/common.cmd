@if not defined CCPOKE_PORT (
  if exist "%USERPROFILE%\.ccpoke\hooks\.env.cmd" (
    call "%USERPROFILE%\.ccpoke\hooks\.env.cmd"
  ) else (
    exit /b 0
  )
)
@if not defined CCPOKE_HOST set CCPOKE_HOST=localhost
set CCPOKE_PANE_ID=
if defined TMUX_PANE set CCPOKE_PANE_ID=%TMUX_PANE%
