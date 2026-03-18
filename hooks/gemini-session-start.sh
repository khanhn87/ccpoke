#!/bin/bash
. "$HOME/.ccpoke/hooks/lib/common.sh"

INPUT=$(cat)
echo '{}'
(
ccpoke_detect_tmux
INPUT=$(ccpoke_inject_tmux "$INPUT")
ccpoke_post "/hook/session-start" "$INPUT" 5
) &
