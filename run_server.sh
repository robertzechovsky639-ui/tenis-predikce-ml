#!/bin/bash
# Server na pozadí s automatickým restartem: setsid nohup ./run_server.sh &
cd "$(dirname "$0")/backend"
while true; do TENIS_LIVE_POLL=3 ../.venv/bin/uvicorn app:app --host 0.0.0.0 --port 8765 >> ../server.log 2>&1; sleep 3; done
