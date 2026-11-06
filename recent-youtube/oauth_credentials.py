"""Use the same private OAuth handoff as the auto-live worker."""
import asyncio
import json
import os
from pathlib import Path
import tempfile

EXPECTED_CHANNEL = 'UCTyCC-_QhsV01cN2CAzN3Fg'


def valid(data, channel):
    return (isinstance(data, dict) and isinstance(data.get('version'), str)
            and isinstance(data.get('channel'), dict)
            and data['channel'].get('id') == channel
            and isinstance(data.get('credentials'), dict)
            and all(isinstance(data['credentials'].get(k), str)
                    and 0 < len(data['credentials'][k]) <= 8192
                    and not any(c in data['credentials'][k] for c in '\r\n')
                    for k in ('client_id', 'client_secret', 'refresh_token')))


def read_credentials(root, channel=EXPECTED_CHANNEL):
    path = Path(root) / 'oauth-token.json'
    try:
        if path.is_symlink() or path.stat().st_mode & 0o077 or path.stat().st_size > 32768:
            return None
        data = json.loads(path.read_text())
        return data if valid(data, channel) else None
    except (OSError, ValueError, TypeError):
        return None


def save_credentials(root, data):
    root = Path(root)
    name = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=root, prefix='.oauth-', delete=False) as f:
            name = f.name
            os.fchmod(f.fileno(), 0o600)
            json.dump({'version': data['version'], 'credentials': data['credentials'], 'channel': data['channel']}, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, root / 'oauth-token.json')
        name = None
    finally:
        if name:
            os.unlink(name)


async def sync_credentials(client, root, base, channel=EXPECTED_CHANNEL):
    directory = os.environ.get('CREDENTIALS_DIRECTORY')
    if not directory:
        return None
    secret = await asyncio.to_thread((Path(directory) / 'youtube-oauth-worker-token').read_text)
    secret = secret.strip()
    if len(secret) < 32:
        raise ValueError('oauth_sync_worker_token_invalid')
    current = await asyncio.to_thread(read_credentials, root, channel)
    response = await client.get(base + '/internal/youtube-oauth/credentials',
                                params={'version': current['version'] if current else ''},
                                headers={'Authorization': 'Bearer ' + secret}, timeout=20,
                                allow_redirects=False)
    if response.status_code != 200:
        raise ValueError('oauth_sync_http_' + str(response.status_code))
    data = response.json()
    if data.get('unchanged'):
        return current['version'] if current else None
    if not data.get('connected'):
        return None
    if not valid(data, channel):
        raise ValueError('oauth_sync_channel_or_credentials_invalid')
    await asyncio.to_thread(save_credentials, root, data)
    return data['version']
