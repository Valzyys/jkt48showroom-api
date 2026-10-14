#!/usr/bin/env python3
"""Upload the existing VPS token through stdin, then deploy the configured Worker."""
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
workers = root / 'workers'
wrangler = ['node', str(workers / 'node_modules/wrangler/bin/wrangler.js')]
env = {**os.environ, 'CI': 'true'}
# Check account access before reading or uploading the service token.
check = subprocess.run(wrangler + ['secret', 'list', '--format', 'json'], cwd=workers,
                       env=env, capture_output=True, text=True)
if check.returncode:
    sys.exit('Cloudflare authentication/access required; token was not uploaded.')
try:
    if not isinstance(json.loads(check.stdout), list):
        raise ValueError()
except ValueError:
    sys.exit('Could not verify Worker access; token was not uploaded.')
values = dict(line.split('=', 1) for line in Path('/etc/jkt48-scraper.env').read_text().splitlines()
              if line and not line.startswith('#'))
token = values['SCRAPER_TOKEN']
result = subprocess.run(wrangler + ['secret', 'put', 'JKT48_SCRAPER_TOKEN'],
                        input=token + '\n', text=True, cwd=workers, env=env,
                        capture_output=True)
if result.returncode:
    sys.exit('Scraper secret upload failed; output suppressed to protect credentials.')
print('Scraper secret installed without displaying its value.', flush=True)
raise SystemExit(subprocess.run(['npm', 'run', 'deploy'], cwd=workers, env=env).returncode)
