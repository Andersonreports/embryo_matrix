#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/backend"

if [ ! -f ".venv/bin/python" ]; then
    echo "Setting up virtual environment..."
    python3 -m venv .venv
    ".venv/bin/python" -m pip install -q --upgrade pip
    ".venv/bin/python" -m pip install -q -r requirements.txt
fi

# Embryo names must split into the right embryos (tests/embryo-names.test.js); warn loudly if a change broke that.
if command -v node >/dev/null 2>&1; then
    if ! node --test ../tests/*.test.js >/dev/null 2>&1; then
        echo "WARNING: embryo-name tests FAILED - embryo counts / result matching may be wrong. Run: node --test tests/*.test.js"
    fi
fi

PORT=8001
echo "Starting Embryo Matrix on http://127.0.0.1:${PORT} (also reachable on your LAN IP)"
LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -n "$LAN_IP" ] && echo "Teammates open: http://${LAN_IP}:${PORT}"
if grep -qiE '^BUILTIN_LOGIN=(true|1|yes)' .env 2>/dev/null; then
    echo "Sign-in is on: each person needs a user account (tools/manage_users.py)."
else
    echo "WARNING: sign-in is off - anyone on the LAN can open it with no password."
fi
".venv/bin/python" -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT}" --reload
