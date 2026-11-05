#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
command -v curl >/dev/null || { echo 'curl diperlukan.' >&2; exit 1; }
if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi
exec .venv/bin/uvicorn audio_server:app --host 127.0.0.1 --port 8815 --workers 1
