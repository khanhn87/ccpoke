#!/bin/bash
. "$HOME/.ccpoke/hooks/lib/common.sh"

JSON="$1"
[ -z "$JSON" ] && exit 0
ccpoke_detect_tmux
JSON=$(ccpoke_inject_tmux "$JSON")
ccpoke_post "/hook/stop?agent=codex" "$JSON" 10
