"""Private OAuth credential handoff. No token values are logged."""
import asyncio
import json
import os
import tempfile
from pathlib import Path

API = 'https://api.jkt48connect.app/internal/youtube-oauth'


def load_credentials(directory):
    path = Path(directory) / 'oauth-token.json'
    try:
        if path.is_symlink() or path.stat().st_mode & 0o077 or path.stat().st_size > 32768:
            return None
        data = json.loads(path.read_text())
        return data if valid(data) else None
    except (OSError, ValueError, TypeError):
        return None


def valid(data):
    return (isinstance(data, dict) and isinstance(data.get('version'), str)
            and isinstance(data.get('credentials'), dict)
            and all(isinstance(data['credentials'].get(k), str)
                    and 0 < len(data['credentials'][k]) <= 8192
                    and '\n' not in data['credentials'][k]
                    and '\r' not in data['credentials'][k]
                    for k in ('client_id', 'client_secret', 'refresh_token')))


async def sync_credentials(client, directory, worker_token):
    current = await asyncio.to_thread(load_credentials, directory)
    headers = {'Authorization': 'Bearer ' + worker_token, 'Accept': 'application/json'}
    response = await client.get(API + '/credentials', params={'version': current['version'] if current else ''},
                                headers=headers, timeout=15, follow_redirects=False)
    if response.status_code != 200:
        return 'oauth_sync_http_' + str(response.status_code)
    data = response.json()
    if not data.get('connected'):
        return None
    if data.get('unchanged'):
        if not current or current.get('acknowledged'):
            return None
        data = current
    if not valid(data):
        return 'oauth_sync_invalid_response'
    await asyncio.to_thread(save_credentials, directory, data)
    ack = await client.post(API + '/ack', json={'version': data['version']}, headers=headers,
                            timeout=15, follow_redirects=False)
    if ack.status_code == 200:
        data['acknowledged'] = True
        await asyncio.to_thread(save_credentials, directory, data)
        return 'oauth_credentials_updated'
    return 'oauth_saved_ack_pending'


def save_credentials(directory, data):
    directory = Path(directory)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    name = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=directory, prefix='.oauth-', delete=False) as f:
            name = f.name
            os.fchmod(f.fileno(), 0o600)
            json.dump({'version': data['version'], 'credentials': data['credentials'], 'channel': data.get('channel'),
                       'acknowledged': bool(data.get('acknowledged'))}, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, directory / 'oauth-token.json')
        name = None
    finally:
        if name:
            os.unlink(name)
