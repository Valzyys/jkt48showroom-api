#!/usr/bin/env bash
set -euo pipefail
if [[ ${EUID} -ne 0 ]]; then
  printf 'Run this installer using sudo on the target VPS.\n' >&2
  exit 1
fi
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
apt-get update
apt-get install -y python3 python3-venv caddy
if ! id -u jkt48-scraper >/dev/null 2>&1; then
  useradd --system --home-dir /opt/jkt48-scraper --shell /usr/sbin/nologin jkt48-scraper
fi
install -d -m 0755 /opt/jkt48-scraper
install -m 0644 "$source_dir/app.py" "$source_dir/requirements.txt" /opt/jkt48-scraper/
python3 -m venv /opt/jkt48-scraper/.venv
/opt/jkt48-scraper/.venv/bin/python -m pip install -r /opt/jkt48-scraper/requirements.txt
python3 - <<'PY'
import os
import secrets
path = '/etc/jkt48-scraper.env'
try:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    pass
else:
    with os.fdopen(fd, 'w') as stream:
        stream.write('SCRAPER_TOKEN=' + secrets.token_hex(32) + '\n')
os.chmod(path, 0o600)
PY
install -m 0644 "$source_dir/deploy/jkt48-scraper.service" /etc/systemd/system/jkt48-scraper.service
install -d -m 0755 /etc/caddy/jkt48-sites
install -m 0644 "$source_dir/deploy/Caddyfile" /etc/caddy/jkt48-sites/scraper.caddy
if ! grep -Fqx 'import /etc/caddy/jkt48-sites/*.caddy' /etc/caddy/Caddyfile; then
  cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.before-jkt48
  printf '\nimport /etc/caddy/jkt48-sites/*.caddy\n' >> /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl daemon-reload
systemctl enable --now jkt48-scraper
systemctl restart jkt48-scraper
systemctl enable --now caddy
systemctl reload caddy
printf 'Installed. Check systemctl status jkt48-scraper and https://scrape.jkt48connect.com/health.\n'
printf 'Point DNS to this VPS and allow TCP 80/443. SCRAPER_TOKEN is kept private in /etc/jkt48-scraper.env.\n'
