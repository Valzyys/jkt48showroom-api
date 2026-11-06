"""Independent playlist categorization; never changes a video's privacy."""
import asyncio
import contextlib
from datetime import datetime, timedelta
import hashlib
import json
import logging
import os
import re
import sys
import time
from urllib.parse import urlencode
from zoneinfo import ZoneInfo
from email.utils import parsedate_to_datetime

sys.path.insert(0, os.environ.get('THEATER_CODE_DIR', '/opt/jkt48-theater-recorder'))
from recorder import Failure

log = logging.getLogger('recent-youtube-playlists')
MARKER = 'JKT48Connect-Playlist: '
GROUP_VERSION = 2
MONTHS = ('Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
          'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember')


def month_category(row):
    # Archive chronology follows the live start in WIB, not upload/retry time.
    try:
        start = datetime.fromisoformat(str(row['started_at']).replace('Z', '+00:00'))
        if not start.tzinfo:
            raise ValueError('timezone missing')
        local = start.astimezone(ZoneInfo('Asia/Jakarta'))
    except (KeyError, ValueError, TypeError, OverflowError):
        raise Failure('playlist_start_date_invalid') from None
    return ('month:' + local.strftime('%Y-%m'),
            f'{MONTHS[local.month - 1]} {local.year} • JKT48 Live Chapter')


def needs_grouping(row):
    return row.get('playlist_status') != 'grouped' or row.get('_playlist_group_version', 0) < GROUP_VERSION


def normal(value):
    return ' '.join(str(value or '').casefold().split())


def rejected(error):
    code = str(error)
    return code == 'playlist_quota' or bool(re.fullmatch(r'playlist_http_4\d\d', code) and code != 'playlist_http_408')


def plan(row, members):
    member = members.get(normal(row['name']), {})
    nickname = next((n.strip() for n in member.get('nicknames', []) if isinstance(n, str) and n.strip()), row['name'])
    nickname = re.sub(r'\s+JKT48$', '', nickname, flags=re.I).strip()
    identity = member.get('id') or hashlib.sha256(normal(row['name']).encode()).hexdigest()[:24]
    return [('member:' + str(identity), nickname + ' JKT48'),
            ('platform:' + row['type'], 'IDN Live JKT48' if row['type'] == 'idn' else 'Showroom Live JKT48'),
            month_category(row)]


def eligible(row, now=None):
    if not row.get('_transfer_complete') or not row.get('youtube_id') or row.get('youtube_privacy') != 'public':
        return False
    if row['type'] == 'idn':
        try:
            date = datetime.fromisoformat(str(row['ended_at']).replace('Z', '+00:00'))
            if not date.tzinfo:
                return False
            end = date.timestamp()
        except (ValueError, TypeError):
            return False
        if (time.time() if now is None else now) < end + 72 * 3600:
            return False
    return True


class PlaylistManager:
    def __init__(self, uploader):
        self.u = uploader
        self.db = uploader.store.db
        self.db.execute('CREATE TABLE IF NOT EXISTS yt_playlists(key TEXT PRIMARY KEY,title TEXT NOT NULL,youtube_id TEXT,state TEXT NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS yt_playlist_items(playlist_id TEXT NOT NULL,video_id TEXT NOT NULL,item_id TEXT,state TEXT NOT NULL,PRIMARY KEY(playlist_id,video_id))')
        self.db.execute('CREATE TABLE IF NOT EXISTS yt_playlist_budget(day TEXT PRIMARY KEY,units INTEGER NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS yt_playlist_control(key TEXT PRIMARY KEY,value REAL NOT NULL)')
        self.db.commit()
        self.members = {}
        self.catalog_until = 0
        retry = self.db.execute("SELECT value FROM yt_playlist_control WHERE key='retry_at'").fetchone()
        self.retry_at = retry[0] if retry else 0
        self.remote = None
        self.platforms_ready = False

    def defer(self, until):
        self.retry_at = max(self.retry_at, until)
        self.db.execute("INSERT INTO yt_playlist_control VALUES('retry_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (self.retry_at,))
        self.db.commit()

    async def request(self, method, resource, params, value=None):
        r = await self.u.youtube.request(method, 'https://www.googleapis.com/youtube/v3/' + resource + '?' + urlencode(params),
            **({'headers': {'Content-Type': 'application/json'}, 'data': json.dumps(value)} if value is not None else {}))
        if r.status_code not in (200, 201):
            try:
                reason = r.json().get('error', {}).get('errors', [{}])[0].get('reason', '')
            except Exception:
                reason = ''
            if reason in ('quotaExceeded', 'dailyLimitExceeded'):
                self.defer(time.time() + 6 * 3600)
                raise Failure('playlist_quota')
            if r.status_code == 429 or reason in ('rateLimitExceeded', 'userRateLimitExceeded'):
                delay = 300
                retry = str(r.headers.get('Retry-After', ''))
                if retry.isdecimal():
                    delay = max(delay, min(86400, int(retry)))
                elif retry:
                    try:
                        delay = max(delay, parsedate_to_datetime(retry).timestamp() - time.time())
                    except (ValueError, TypeError, OverflowError):
                        pass
                self.defer(time.time() + min(delay, 86400))
                raise Failure('playlist_http_429')
            raise Failure('playlist_http_' + str(r.status_code))
        return r.json()

    def spend(self):
        # Playlist inserts cost 50 units each. Keep the larger share of quota
        # available for video uploads, processing checks and 72-hour publishing.
        now = datetime.now(ZoneInfo('America/Los_Angeles'))
        day = now.date().isoformat()
        old = self.db.execute('SELECT units FROM yt_playlist_budget WHERE day=?', (day,)).fetchone()
        units = old[0] if old else 0
        if units + 50 > 3000:
            tomorrow = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), tzinfo=now.tzinfo)
            self.defer(tomorrow.timestamp() + 60)
            raise Failure('playlist_daily_budget')
        self.db.execute('INSERT INTO yt_playlist_budget VALUES(?,?) ON CONFLICT(day) DO UPDATE SET units=excluded.units', (day, units + 50))
        self.db.commit()

    async def catalog(self):
        r = await self.u.client.get(self.u.base + '/internal/collector/config',
            headers={'Authorization': 'Bearer ' + os.environ['COLLECTOR_TOKEN']}, allow_redirects=False, timeout=30)
        if r.status_code != 200:
            raise Failure('playlist_members_unavailable')
        # Ignore the other private collector configuration fields entirely.
        members = r.json().get('members', [])
        if not members:
            raise Failure('playlist_members_empty')
        self.members = {normal(m['name']): m for m in members}
        self.catalog_until = time.time() + 6 * 3600

    async def inventory(self):
        result = []
        token = None
        for _ in range(100):
            params = {'part': 'snippet,status', 'mine': 'true', 'maxResults': 50}
            if token:
                params['pageToken'] = token
            body = await self.request('GET', 'playlists', params)
            result.extend(body.get('items', []))
            token = body.get('nextPageToken')
            if not token:
                self.remote = result
                return
        raise Failure('playlist_inventory_incomplete')

    async def ensure(self, key, title):
        local = self.db.execute('SELECT youtube_id,state FROM yt_playlists WHERE key=?', (key,)).fetchone()
        if local and local[0]:
            return local[0]
        if self.remote is None or (local and local[1] == 'uncertain'):
            await self.inventory()
        matches = [p for p in self.remote if MARKER + key in p.get('snippet', {}).get('description', '').splitlines()]
        if not matches:
            matches = [p for p in self.remote if normal(p['snippet']['title']) == normal(title)]
        if len(matches) > 1:
            raise Failure('playlist_identity_ambiguous')
        if matches:
            video_id = matches[0]['id']
        else:
            if local and local[1] == 'uncertain':
                raise Failure('playlist_creation_uncertain')
            self.spend()
            self.db.execute('INSERT INTO yt_playlists VALUES(?,?,NULL,?) ON CONFLICT(key) DO UPDATE SET state=excluded.state', (key, title, 'uncertain'))
            self.db.commit()
            try:
                body = await self.request('POST', 'playlists', {'part': 'snippet,status'}, {
                    'snippet': {'title': title, 'description': 'Koleksi replay ' + title + '.\n\n' + MARKER + key},
                    'status': {'privacyStatus': 'public'}})
            except Failure as e:
                if rejected(e):
                    self.db.execute("UPDATE yt_playlists SET state='retry' WHERE key=?", (key,))
                    self.db.commit()
                raise
            video_id = body.get('id')
            if not video_id:
                raise Failure('playlist_identity_missing')
            self.remote.append(body)
        self.db.execute('INSERT INTO yt_playlists VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET youtube_id=excluded.youtube_id,state=excluded.state', (key, title, video_id, 'ready'))
        self.db.commit()
        return video_id

    async def include(self, playlist_id, video_id):
        old = self.db.execute('SELECT item_id,state FROM yt_playlist_items WHERE playlist_id=? AND video_id=?', (playlist_id, video_id)).fetchone()
        if old and old[1] == 'added':
            return
        for attempt in range(5):
            try:
                found = await self.request('GET', 'playlistItems', {'part': 'id,snippet', 'playlistId': playlist_id, 'videoId': video_id, 'maxResults': 50})
                break
            except Failure as e:
                # Newly created playlists can be listed before their item endpoint
                # propagates. Retry reads only; never blindly repeat the insert.
                if str(e) != 'playlist_http_404' or attempt == 4:
                    raise
                await self.u.wait(2 ** attempt)
        items = found.get('items', [])
        if items:
            item_id = items[0]['id']
        else:
            # Never repeat an ambiguous mutation simply because the response was lost.
            if old and old[1] == 'uncertain':
                raise Failure('playlist_membership_uncertain')
            self.spend()
            self.db.execute('INSERT INTO yt_playlist_items VALUES(?,?,NULL,?) ON CONFLICT(playlist_id,video_id) DO UPDATE SET state=excluded.state', (playlist_id, video_id, 'uncertain'))
            self.db.commit()
            try:
                body = await self.request('POST', 'playlistItems', {'part': 'snippet'}, {
                    'snippet': {'playlistId': playlist_id, 'resourceId': {'kind': 'youtube#video', 'videoId': video_id}}})
            except Failure as e:
                if rejected(e):
                    self.db.execute("UPDATE yt_playlist_items SET state='retry' WHERE playlist_id=? AND video_id=?", (playlist_id, video_id))
                    self.db.commit()
                raise
            item_id = body.get('id')
            if not item_id:
                raise Failure('playlist_item_missing')
        self.db.execute('INSERT INTO yt_playlist_items VALUES(?,?,?,?) ON CONFLICT(playlist_id,video_id) DO UPDATE SET item_id=excluded.item_id,state=excluded.state', (playlist_id, video_id, item_id, 'added'))
        self.db.commit()

    async def group(self, row):
        if not eligible(row):
            return
        targets = plan(row, self.members)
        # Shared categories first, so a member-playlist rejection does not lose
        # the month/platform work. Persist every successful membership.
        categories = {p['key']: p for p in row.get('playlists', []) if p.get('key')}
        row['playlist_status'] = 'grouping'
        for key, title in sorted(targets, key=lambda p: 0 if p[0].startswith('month:') else 1 if p[0].startswith('platform:') else 2):
            playlist_id = await self.ensure(key, title)
            await self.include(playlist_id, row['youtube_id'])
            categories[key] = {'key': key, 'title': title, 'url': 'https://www.youtube.com/playlist?list=' + playlist_id}
            row['playlists'] = [categories[k] for k, _ in targets if k in categories]
            self.u.store.save(row)
        row['playlist_status'] = 'grouped'
        row['_playlist_group_version'] = GROUP_VERSION
        row.pop('playlist_error', None)
        row.pop('_playlist_retry_at', None)
        self.u.store.save(row)
        log.info('categorized id=%s member=%s platform=%s month=%s', row['id'], targets[0][1], targets[1][1], targets[2][1])

    async def run(self):
        while not self.u.stop.is_set():
            try:
                if self.u.scanned and time.time() >= self.retry_at:
                    if not self.platforms_ready:
                        await self.ensure('platform:showroom', 'Showroom Live JKT48')
                        await self.ensure('platform:idn', 'IDN Live JKT48')
                        self.platforms_ready = True
                    candidates = [r for r in self.u.rows.values() if eligible(r) and needs_grouping(r) and r.get('_playlist_retry_at', 0) <= time.time()]
                    candidates.sort(key=lambda r: r['ended_at'], reverse=True)
                    if candidates:
                        if self.catalog_until <= time.time():
                            await self.catalog()
                        row = candidates[0]
                        try:
                            await self.group(row)
                        except Exception as e:
                            code = str(e) if isinstance(e, Failure) else 'playlist_network_error'
                            row['playlist_error'] = code
                            row['_playlist_retry_at'] = max(self.retry_at, time.time() + 300)
                            self.u.store.save(row)
                            log.warning('categorization-error id=%s error=%s', row['id'], code)
                        continue
            except Exception as e:
                log.warning('playlist-loop-error code=%s', str(e) if isinstance(e, Failure) else 'playlist_network_error')
                self.retry_at = max(self.retry_at, time.time() + 300)
            await self.u.wait(15)
