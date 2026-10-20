#!/bin/bash
# Udržuje server + cloudflared quick tunnel v běhu (restart při pádu). URL se zapíše do public_url.txt.
cd "$(dirname "$0")"
( while true; do cd backend && TENIS_LIVE_POLL=3 ../.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8765 >> ../server.log 2>&1; cd ..; sleep 3; done ) &
( while true; do ~/.local/bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8765 2>&1 | tee -a tunnel.log | grep --line-buffered -o 'https://[a-z0-9-]*\.trycloudflare\.com' | while read u; do echo "$u" > public_url.txt; done; sleep 5; done ) &
wait
