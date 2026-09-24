#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -f ".venv/bin/python" ]; then
    echo "Setting up virtual environment..."
    python3 -m venv .venv
    ".venv/bin/python" -m pip install -q --upgrade pip
    ".venv/bin/python" -m pip install -q -r requirements.txt
fi

PORT=8001
echo "Starting Embryo Matrix on http://127.0.0.1:${PORT} (also reachable on your LAN IP)"
echo "WARNING: this build has no login of its own - anyone on the LAN can open it with no password."
".venv/bin/python" -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT}" --reload
