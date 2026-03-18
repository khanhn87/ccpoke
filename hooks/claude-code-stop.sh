#!/bin/bash
. "$HOME/.ccpoke/hooks/lib/common.sh"

INPUT=$(cat | tr -d '\n\r')
echo "$INPUT" | grep -q '"session_id"' || exit 0
ccpoke_detect_tmux
INPUT=$(ccpoke_inject_tmux "$INPUT")
ccpoke_post "/hook/stop?agent=claude-code" "$INPUT" 10
