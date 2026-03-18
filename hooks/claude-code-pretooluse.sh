#!/bin/bash
. "$HOME/.ccpoke/hooks/lib/common.sh"

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)
[ "$TOOL_NAME" != "AskUserQuestion" ] && exit 0

SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -z "$SESSION_ID" ] && exit 0

ccpoke_detect_tmux
INPUT=$(ccpoke_inject_tmux "$INPUT")
ccpoke_post "/hook/ask-user-question" "$INPUT" 3
