#!/bin/bash
. "$HOME/.ccpoke/hooks/lib/common.sh"

[ -z "$TMUX" ] && exit 0

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
CWD=$(echo "$INPUT" | grep -o '"cwd":"[^"]*"' | head -1 | cut -d'"' -f4)

[ -z "$SESSION_ID" ] && exit 0

ccpoke_detect_tmux

PAYLOAD=$(printf '{"session_id":"%s","cwd":"%s","pane_id":"%s"}' \
  "$(ccpoke_json_escape "$SESSION_ID")" "$(ccpoke_json_escape "$CWD")" "$(ccpoke_json_escape "$CCPOKE_PANE_ID")")

ccpoke_post "/hook/session-start" "$PAYLOAD" 3
