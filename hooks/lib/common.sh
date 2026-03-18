#!/bin/bash
# ccpoke shared hook library

CCPOKE_ENV_FILE="$HOME/.ccpoke/hooks/.env"
[ -f "$CCPOKE_ENV_FILE" ] || exit 0
. "$CCPOKE_ENV_FILE"

CCPOKE_HOST="${CCPOKE_HOST:-localhost}"

ccpoke_detect_tmux() {
  CCPOKE_PANE_ID=""
  [ -n "$TMUX_PANE" ] || return 0
  CCPOKE_PANE_ID="$TMUX_PANE"
}

ccpoke_inject_tmux() {
  local json="$1"
  if [ -n "$CCPOKE_PANE_ID" ] && \
     echo "$CCPOKE_PANE_ID" | grep -qE '^%[0-9]+$'; then
    echo "$json" | sed 's/}$/,"pane_id":"'"$CCPOKE_PANE_ID"'"}/'
  else
    echo "$json"
  fi
}

ccpoke_post() {
  local route="$1"
  local payload="$2"
  local max_time="${3:-5}"
  echo "$payload" | curl -s -X POST "http://$CCPOKE_HOST:$CCPOKE_PORT$route" \
    -H "Content-Type: application/json" \
    -H "X-CCPoke-Secret: $CCPOKE_SECRET" \
    --data-binary @- --max-time "$max_time" > /dev/null 2>&1 || true
}

ccpoke_json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g' | tr -d '\n\r'
}
