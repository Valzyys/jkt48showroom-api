"""R2 range -> bounded RAM -> YouTube. Video bytes are never written to disk."""
import asyncio
import contextlib
from datetime import datetime, timezone, timedelta
import fcntl
import json
import logging
import os
from pathlib import Path
import random
import re
import signal
import sqlite3
import sys
import time
from urllib.parse import urlencode, urlparse
from zoneinfo import ZoneInfo

# Reuse the theater recorder's OAuth transport, not its upload/privacy policy.
sys.path.insert(0, os.environ.get('THEATER_CODE_DIR', '/opt/jkt48-theater-recorder'))
from recorder import YouTube, Failure
from curl_cffi.requests import AsyncSession
from curl_cffi.const import CurlHttpVersion
sys.path.insert(0, str(Path(__file__).resolve().parent))
from playlist_manager import PlaylistManager
from oauth_credentials import read_credentials, sync_credentials

log = logging.getLogger('recent-youtube')
CHUNK = 2 * 1024 * 1024
EMBARGO = 72 * 3600
WIB = timezone(timedelta(hours=7))
MARKER = 'JKT48Connect-Replay: '


def pacific_reset(now=None):
    local = datetime.fromtimestamp(time.time() if now is None else now, ZoneInfo('America/Los_Angeles'))
    return datetime.combine(local.date() + timedelta(days=1), datetime.min.time(), tzinfo=local.tzinfo).timestamp() + 60


class UploadLimit(Failure):
    def __init__(self, code, reason, http_status, retry_at):
        super().__init__(code)
        self.reason, self.http_status, self.retry_at = reason, http_status, retry_at


class RecentYouTube(YouTube):
    async def token(self):
        if not hasattr(self, '_credential_lock'):
            self._credential_lock = asyncio.Lock()
        async with self._credential_lock:
            if self.access and self.until > time.time():
                return self.access
            root = os.environ.get('RECENT_YOUTUBE_STATE_DIR', '/var/lib/jkt48-recent-youtube')
            channel = os.environ.get('RECENT_YOUTUBE_CHANNEL_ID', 'UCTyCC-_QhsV01cN2CAzN3Fg')
            saved = await asyncio.to_thread(read_credentials, root, channel)
            credentials = saved['credentials'] if saved else {
                'client_id': os.environ['YOUTUBE_CLIENT_ID'],
                'client_secret': os.environ['YOUTUBE_CLIENT_SECRET'],
                'refresh_token': os.environ['YOUTUBE_REFRESH_TOKEN']}
            try:
                r = await self.client.post('https://oauth2.googleapis.com/token',
                    data={**credentials, 'grant_type': 'refresh_token'}, timeout=25, allow_redirects=False)
                data = r.json()
                if r.status_code != 200 or not data.get('access_token'):
                    code = data.get('error')
                    raise Failure('oauth_' + code if code in ('invalid_grant', 'unauthorized_client', 'invalid_client') else 'oauth_error')
                self.access, self.until = data['access_token'], time.time() + int(data.get('expires_in', 3600)) - 120
                self.auth_status, self.auth_error = 'ready', None
                return self.access
            except Exception as error:
                self.auth_status = 'error'
                self.auth_error = str(error) if isinstance(error, Failure) else 'oauth_network'
                raise Failure(self.auth_error) from None

    async def request(self, method, url, **kwargs):
        # Resumable video bodies must not share the HTTP/2 metadata connection.
        if method.upper() == 'PUT' and urlparse(url).path.startswith('/upload/'):
            kwargs.setdefault('http_version', CurlHttpVersion.V1_1)
        return await super().request(method, url, **kwargs)

    def reject(self, response):
        try:
            body = response.json().get('error', {})
            reason = body.get('errors', [{}])[0].get('reason', '')
            message = str(body.get('message', '')).lower()
        except (ValueError, AttributeError, IndexError, TypeError):
            reason, message = '', ''
        # Persist only known reason codes, never Google's raw error text/URLs.
        now = time.time()
        if reason == 'uploadLimitExceeded':
            raise UploadLimit('youtube_channel_upload_limit', reason, response.status_code, now + 86400 + 60)
        if reason in ('quotaExceeded', 'dailyLimitExceeded') or (
                (reason in ('rateLimitExceeded', 'userRateLimitExceeded') or response.status_code == 429) and
                any(term in message for term in ('per day', 'perday', 'per_day', 'daily'))):
            raise UploadLimit('youtube_project_daily_quota', reason if reason in ('quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded') else 'http429_daily', response.status_code, pacific_reset(now))
        if reason in ('rateLimitExceeded', 'userRateLimitExceeded') or response.status_code == 429:
            retry = str(response.headers.get('Retry-After', ''))
            delay = max(120, min(86400, int(retry))) if retry.isdecimal() else 120
            raise UploadLimit('youtube_rate_limit', reason if reason in ('rateLimitExceeded', 'userRateLimitExceeded') else 'http429',
                              response.status_code, now + delay)
        super().reject(response)


def epoch(value):
    try:
        d = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return d.timestamp() if d.tzinfo else None
    except (ValueError, TypeError, OverflowError):
        return None


def privacy(row, now=None):
    if row['type'] == 'showroom':
        return 'public'
    end = epoch(row.get('ended_at'))
    return 'public' if end and (time.time() if now is None else now) >= end + EMBARGO else 'unlisted'


def clean(value):
    return re.sub(r'\s+', ' ', re.sub(r'[<>\x00-\x1f]', '', str(value or ''))).strip()


def title_clip(value, units):
    return value.encode('utf-16-le')[:max(0, units) * 2].decode('utf-16-le', errors='ignore')


def metadata(row, now=None):
    started = epoch(row.get('started_at'))
    if not started or not epoch(row.get('ended_at')):
        raise Failure('date_unavailable')
    date = datetime.fromtimestamp(started, WIB).strftime('%d-%m-%Y %H.%M WIB')
    source = 'SHOWROOM' if row['type'] == 'showroom' else 'IDN'
    suffix = f' | {source} | {date}'
    if row['part_count'] > 1:
        suffix += f" | Bagian {row['part']}/{row['part_count']}"
    name = clean(row['name'])
    title = clean(row.get('live_title')) or f'Live bersama {name}'
    # Reserve the member, date, platform and part before truncating a long live title.
    prefix = title_clip(name, max(1, min(40, 96 - len(suffix)))) + ' — '
    title = prefix + title_clip(title, 100 - len((prefix + suffix).encode('utf-16-le')) // 2) + suffix
    start_label = datetime.fromtimestamp(started, WIB).strftime('%d %B %Y, %H:%M:%S WIB')
    end_label = datetime.fromtimestamp(epoch(row['ended_at']), WIB).strftime('%d %B %Y, %H:%M:%S WIB')
    description = (f"{name} — {source}\nJudul live: {clean(row.get('live_title')) or 'Live bersama '+name}\n"
                   f'Mulai live: {start_label}\nSelesai live: {end_label}\n'
                   f"Bagian {row['part']} dari {row['part_count']}.\n"
                   'Rekaman sesuai bagian yang tersedia di arsip. Rekaman dapat memiliki jeda atau bagian yang tidak tertangkap; bukan jaminan seluruh durasi live.\n'
                   + (f"IDN: publik setelah 72 jam sejak live berakhir.\n" if row['type'] == 'idn' else '')
                   + '\n' + MARKER + row['id'])
    return {'snippet': {'title': title, 'description': description, 'categoryId': '24',
                        'tags': ['JKT48', source, name]},
            'status': {'privacyStatus': privacy(row, now), 'selfDeclaredMadeForKids': False}}


class Store:
    def __init__(self, root):
        root.mkdir(parents=True, exist_ok=True)
        self.lock = (root / 'uploader.lock').open('a')
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.lock.close()
            raise
        self.db = sqlite3.connect(root / 'state.sqlite')
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,value TEXT NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS upload_control(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
        self.db.commit()

    def save(self, row):
        row['_dirty'] = True
        self.db.execute('INSERT INTO jobs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
                        (row['id'], json.dumps(row)))
        self.db.commit()

    def rows(self):
        return {r['id']: r for r in (json.loads(x[0]) for x in self.db.execute('SELECT value FROM jobs'))}

    def control(self, key, value=None):
        if value is not None:
            self.db.execute('INSERT INTO upload_control VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                            (key, json.dumps(value)))
            self.db.commit()
            return value
        found = self.db.execute('SELECT value FROM upload_control WHERE key=?', (key,)).fetchone()
        return json.loads(found[0]) if found else {}


# Only sessions starting on/after 1 November 2026 00:00 WIB are uploaded.
YOUTUBE_UPLOAD_CUTOFF = datetime(2026, 11, 1, tzinfo=WIB).timestamp()

def upload_eligible(row):
    return (epoch(row.get('started_at')) or 0) >= YOUTUBE_UPLOAD_CUTOFF


class Uploader:
    def __init__(self):
        self.root = Path(os.environ.get('RECENT_YOUTUBE_STATE_DIR', '/var/lib/jkt48-recent-youtube'))
        self.store = Store(self.root)
        self.rows = self.store.rows()
        for row in self.rows.values():
            if not row.get('_playback_metadata_v1') and row.get('youtube_id'):
                row['_playback_metadata_v1'] = True
                self.store.save(row)
            # Older state can have a playlist ID before all bytes were accepted.
            if '_transfer_complete' not in row:
                row['_transfer_complete'] = bool(row.get('youtube_id') and row.get('_upload_offset') == row['bytes'])
            if row.get('_insert_pending') and not row.get('_upload_url') and not row.get('_transfer_complete'):
                row.update(status='needs_review', error='youtube_session_creation_unknown')
        self.base = os.environ.get('RECENT_YOUTUBE_API_TRANSPORT_URL', 'https://api.jkt48connect.app:8443').rstrip('/')
        u = urlparse(self.base)
        if u.scheme != 'https' or u.hostname != 'api.jkt48connect.app' or u.path or u.username or u.password:
            raise Failure('transport_invalid')
        self.client = None
        self.media_client = None
        self.youtube = None
        self.stop = asyncio.Event()
        self.scanned = False
        self.active = set()
        self.insert_lock = asyncio.Lock()
        # The old generic error discarded Google's reason. Reclassify once via
        # a real resumable insert; a definitive rejection created no video.
        if not self.store.control('limit_classifier_v1'):
            for row in self.rows.values():
                if row.get('error') == 'youtube_quota' and not row.get('_upload_url') and not row.get('_transfer_complete') and not row.get('_insert_pending'):
                    row.update(error='youtube_limit_recheck', _retry_at=0)
                    self.store.save(row)
            self.store.control('limit_classifier_v1', {'done': True})
        self.global_retry = self.store.control('backoff').get('until', 0)
        self.next_insert = self.store.control('insert_pacing').get('until', 0)

    def block_inserts(self, error):
        self.global_retry = max(self.global_retry, error.retry_at)
        self.store.control('backoff', {'until': self.global_retry, 'code': str(error),
                                      'reason': error.reason, 'http_status': error.http_status})

    async def api(self, path, value=None, timeout=30):
        r = await self.client.request('GET' if value is None else 'POST',
            self.base + '/internal/collector/recent-youtube/' + path,
            headers={'Authorization': 'Bearer ' + os.environ['COLLECTOR_TOKEN']},
            json=value, allow_redirects=False, timeout=timeout)
        if r.status_code != 200:
            raise Failure('worker_http_' + str(r.status_code))
        return r.json()

    def public(self, row):
        return {'data_id': row['data_id'], 'run': row['run'], 'title': metadata(row)['snippet']['title'],
                'status': row['status'], 'youtube_id': row.get('youtube_id'),
                'privacy': row.get('youtube_privacy'), 'bytes_uploaded': row.get('_upload_offset', 0),
                'error': row.get('error'), 'processing_status': row.get('processing_status')}

    async def discover(self):
        offset = 0
        while offset is not None:
            page = await self.api('manifest?offset=' + str(offset))
            for item in page['items']:
                if not upload_eligible(item):
                    continue
                if not re.fullmatch(r'(sr|idn)-[a-zA-Z0-9_-]{1,150}', item['data_id']):
                    continue
                if not item.get('name') or not epoch(item.get('ended_at')):
                    continue
                # Allow final archive writes to settle; never upload an active run.
                if time.time() - epoch(item['ended_at']) < 120:
                    continue
                clips = sorted(item['recordings'], key=lambda x: int(x['run']))
                remote = {v['run']: v for v in (item.get('youtube_replay') or {}).get('videos', [])}
                for index, clip in enumerate(clips):
                    run = str(clip['run'])
                    if not re.fullmatch(r'\d{1,13}', run) or clip.get('bytes', 0) <= 0:
                        continue
                    key = item['data_id'] + ':' + run
                    if key in self.rows:
                        # An already-open upload always retains its exact source snapshot.
                        continue
                    row = {'id': key, 'data_id': item['data_id'], 'run': run, 'name': item['name'],
                           'type': item['type'], 'started_at': item['started_at'], 'ended_at': item['ended_at'],
                           'live_title': item.get('title'), 'part': index + 1, 'part_count': len(clips),
                           'bytes': int(clip['bytes']), 'status': 'pending', 'error': None,
                           '_retry_at': 0, '_attempts': 0}
                    if remote.get(run, {}).get('youtube_id'):
                        v = remote[run]
                        # Restore identity, but verify the completed YouTube resource
                        # before treating remote metadata as a finished transfer.
                        row.update(youtube_id=v['youtube_id'], youtube_privacy=v.get('privacy'), status='needs_review')
                    self.rows[key] = row
                    self.store.save(row)
            offset = page['next_offset']
        log.info('discovered sessions=%s parts=%s bytes=%s', len({r['data_id'] for r in self.rows.values()}),
                 len(self.rows), sum(r['bytes'] for r in self.rows.values()))

    async def reconcile(self, include_open=False):
        # Description markers recover a completed but locally unacknowledged upload.
        r = await self.youtube.request('GET', 'https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true')
        if r.status_code != 200:
            self.youtube.reject(r)
        items = r.json().get('items', [])
        if len(items) != 1:
            raise Failure('youtube_channel_ambiguous')
        expected = os.environ.get('RECENT_YOUTUBE_CHANNEL_ID', 'UCTyCC-_QhsV01cN2CAzN3Fg')
        if items[0]['id'] != expected:
            raise Failure('youtube_channel_mismatch')
        playlist = items[0]['contentDetails']['relatedPlaylists']['uploads']
        page = None
        seen = {}
        for _ in range(100):
            params = {'part': 'snippet', 'playlistId': playlist, 'maxResults': 50}
            if page:
                params['pageToken'] = page
            r = await self.youtube.request('GET', 'https://www.googleapis.com/youtube/v3/playlistItems?' + urlencode(params))
            if r.status_code != 200:
                self.youtube.reject(r)
            body = r.json()
            for item in body.get('items', []):
                snippet = item['snippet']
                marker = re.search(r'^' + re.escape(MARKER) + r'((?:sr|idn)-[a-zA-Z0-9_-]+:\d{1,13})$',
                                   snippet.get('description', ''), re.M)
                if marker:
                    key = marker[1]
                    video = snippet['resourceId']['videoId']
                    if key in seen and seen[key] != video:
                        raise Failure('youtube_duplicate_marker')
                    seen[key] = video
            page = body.get('nextPageToken')
            if not page:
                break
        else:
            raise Failure('youtube_reconcile_incomplete')
        for key, video in seen.items():
            row = self.rows.get(key)
            if not row or (row.get('_upload_url') and not include_open) or row.get('_transfer_complete'):
                continue
            # playlistItems can include a video whose resumable body is still
            # incomplete. Only completed processing is safe for orphan recovery.
            r = await self.youtube.request('GET', 'https://www.googleapis.com/youtube/v3/videos?' +
                urlencode({'part': 'status,processingDetails,contentDetails', 'id': video}))
            if r.status_code != 200:
                self.youtube.reject(r)
            matches = r.json().get('items', [])
            done = bool(matches and matches[0].get('processingDetails', {}).get('processingStatus') == 'succeeded'
                        and matches[0].get('contentDetails', {}).get('duration') not in (None, 'P0D', 'PT0S'))
            if done:
                row.update(youtube_id=video, status='uploaded', error=None, _transfer_complete=True,
                           _upload_offset=row['bytes'], youtube_privacy=matches[0]['status']['privacyStatus'])
            else:
                row.update(youtube_id=video, status='needs_review', error='youtube_orphan_processing')
            self.store.save(row)
        recovered = 0
        for row in self.rows.values():
            if (upload_eligible(row) and row['status'] == 'needs_review'
                    and row.get('error') == 'youtube_session_creation_unknown'
                    and row.get('_insert_pending') and not row.get('_upload_url')
                    and not row.get('youtube_id') and not row.get('_transfer_complete')
                    and not row.get('_upload_offset') and row['id'] not in seen):
                # Without a session URL no video bytes could have been sent.
                # Completed remote uploads were recovered by their markers above.
                row.update(status='pending', error=None, _insert_pending=False, _retry_at=0)
                self.store.save(row)
                recovered += 1
        if recovered:
            log.info('reconciled-zero-byte-session-jobs count=%s', recovered)
        self.scanned = True

    def result(self, row, response):
        if response.status_code in (200, 201) and row.get('youtube_id') and response.json().get('id') != row['youtube_id']:
            raise Failure('youtube_identity_conflict')
        if not self.youtube.result(row, response):
            return False
        row['_transfer_complete'] = True
        row['_upload_offset'] = row['bytes']
        self.store.save(row)
        return True

    async def source(self, row, start, length):
        end = start + length - 1
        url = self.base + '/media/live/' + row['data_id'] + '/video-' + row['run'] + '.mp4'
        # Keep large body transfers out of the control/playlist connection pool.
        media_client = self.media_client or self.client
        async with media_client.stream('GET', url, headers={'Range': f'bytes={start}-{end}'},
                                      timeout=90, allow_redirects=False) as r:
            if r.status_code != 206:
                raise Failure('source_http_' + str(r.status_code))
            if r.headers.get('Content-Range') != f'bytes {start}-{end}/{row["bytes"]}':
                raise Failure('source_range_changed')
            etag = r.headers.get('ETag')
            if not etag:
                raise Failure('source_identity_missing')
            if row.get('_source_etag') and row['_source_etag'] != etag:
                raise Failure('source_identity_changed')
            if not row.get('_source_etag'):
                row['_source_etag'] = etag
                self.store.save(row)
            out = bytearray()
            async for chunk in r.aiter_content(chunk_size=256 * 1024):
                if len(out) + len(chunk) > length:
                    raise Failure('source_range_overflow')
                out.extend(chunk)
            if len(out) != length:
                raise Failure('source_range_truncated')
            return bytes(out)

    async def visibility(self, row):
        desired = privacy(row)
        if row.get('youtube_privacy') == desired and row.get('_verified') and (row.get('processing_status') == 'succeeded' or row.get('_verify_at', 0) > time.time()):
            return
        r = await self.youtube.request('GET', 'https://www.googleapis.com/youtube/v3/videos?' +
                                      urlencode({'part': 'status,processingDetails', 'id': row['youtube_id']}))
        if r.status_code != 200:
            self.youtube.reject(r)
        videos = r.json().get('items', [])
        if len(videos) != 1:
            raise Failure('youtube_video_missing')
        status = videos[0]['status']
        row['processing_status'] = videos[0].get('processingDetails', {}).get('processingStatus')
        if status.get('uploadStatus') in ('failed', 'rejected', 'deleted') or row['processing_status'] in ('failed', 'terminated'):
            raise Failure('youtube_processing_failed')
        if status.get('privacyStatus') != desired:
            # Preserve the other mutable status fields; do not reset channel preferences.
            writable = {k: v for k, v in status.items() if k in ('license', 'embeddable', 'publicStatsViewable', 'selfDeclaredMadeForKids', 'containsSyntheticMedia')}
            writable['privacyStatus'] = desired
            r = await self.youtube.request('PUT', 'https://www.googleapis.com/youtube/v3/videos?part=status',
                                          headers={'Content-Type': 'application/json'},
                                          data=json.dumps({'id': row['youtube_id'], 'status': writable}))
            if r.status_code != 200:
                self.youtube.reject(r)
            if r.json().get('status', {}).get('privacyStatus') != desired:
                raise Failure('youtube_privacy_restricted')
        row.update(youtube_privacy=desired, _verified=True, _verify_at=time.time()+300, status='uploaded', error=None)
        self.store.save(row)

    async def upload(self, row):
        if not upload_eligible(row):
            raise Failure('before_youtube_cutoff')
        size = row['bytes']
        # Probe before spending an insert call. No video file is created locally.
        await self.source(row, 0, min(16, size))
        if not row.get('_upload_url'):
            async with self.insert_lock:
                await self.create_session(row)
        url = self.youtube.session_url(row['_upload_url'])
        r = await self.youtube.request('PUT', url, headers={'Content-Length': '0', 'Content-Range': f'bytes */{size}'}, data=b'')
        if self.result(row, r):
            return
        if r.status_code in (404, 410):
            # An ambiguous expiry cannot silently start a duplicate upload.
            await self.reconcile(include_open=True)
            if row.get('_transfer_complete'):
                return
            row['status'] = 'needs_review'
            raise Failure('youtube_session_expired_review')
        if r.status_code != 308:
            self.youtube.reject(r)
        offset = int(r.headers['Range'].split('-')[-1]) + 1 if r.headers.get('Range') else 0
        if not 0 <= offset <= size:
            raise Failure('youtube_offset_invalid')
        prefetch = None
        try:
            while offset < size and not self.stop.is_set():
                chunk = await prefetch if prefetch else await self.source(row, offset, min(CHUNK, size - offset))
                prefetch = None
                following = offset + len(chunk)
                if following < size:
                    # At most one chunk ahead, never an entire recording in RAM.
                    prefetch = asyncio.create_task(self.source(row, following, min(CHUNK, size - following)))
                r = await self.youtube.request('PUT', url, headers={'Content-Type': 'video/mp4',
                    'Content-Length': str(len(chunk)), 'Content-Range': f'bytes {offset}-{following-1}/{size}'}, data=chunk)
                if r.status_code in (200, 201) and following != size:
                    raise Failure('youtube_premature_completion')
                if self.result(row, r):
                    row['_upload_offset'] = size
                    self.store.save(row)
                    return
                if r.status_code != 308:
                    self.youtube.reject(r)
                ack = int(r.headers['Range'].split('-')[-1]) + 1 if r.headers.get('Range') else 0
                if ack != following:
                    raise Failure('youtube_offset_invalid')
                offset = ack
                row['_upload_offset'] = offset
                self.store.save(row)
        finally:
            if prefetch:
                prefetch.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await prefetch
        if not row.get('_transfer_complete') and not self.stop.is_set():
            raise Failure('youtube_completion_unknown')

    async def create_session(self, row):
        # Serializing insert requests prevents another worker probing the same
        # known limit. Open byte transfers and playlist jobs remain independent.
        if time.time() < max(self.global_retry, self.next_insert):
            raise Failure('youtube_insert_wait')
        size = row['bytes']
        try:
            # Local safety budget leaves capacity for theater. The actual Google
            # project/channel allowance can be lower. Count attempts first.
            now = datetime.now(ZoneInfo('America/Los_Angeles'))
            day = now.date().isoformat()
            count = sum(r.get('_insert_count', 0) for r in self.rows.values() if r.get('_insert_day') == day)
            if count >= 90:
                raise UploadLimit('youtube_daily_budget', 'local_budget', 0, pacific_reset())
            # Reject expired credentials before marking a session insertion.
            await self.youtube.token()
            row['_insert_count'] = row.get('_insert_count', 0) + 1 if row.get('_insert_day') == day else 1
            row['_insert_day'] = day
            row['_insert_pending'] = True
            self.store.save(row)
            body = metadata(row)
            self.next_insert = time.time() + 60
            self.store.control('insert_pacing', {'until': self.next_insert})
            try:
                r = await self.youtube.request('POST', 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=false',
                    headers={'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': str(size), 'X-Upload-Content-Type': 'video/mp4'}, data=json.dumps(body))
            except Exception as error:
                if isinstance(error, Failure) and str(error).startswith('oauth_'):
                    row['_insert_pending'] = False
                    self.store.save(row)
                    raise
                row['status'] = 'needs_review'
                raise Failure('youtube_session_creation_unknown') from None
            if r.status_code not in (200, 201):
                row['_insert_pending'] = False
                self.store.save(row)
                self.youtube.reject(r)
            try:
                row['_upload_url'] = self.youtube.session_url(r.headers.get('Location', ''))
            except Exception:
                row['status'] = 'needs_review'
                raise Failure('youtube_session_creation_unknown') from None
            row['_insert_pending'] = False
            row['_upload_offset'] = 0
            self.store.save(row)
        except UploadLimit as error:
            self.block_inserts(error)
            raise

    def failed(self, row, error):
        code = str(error) if isinstance(error, Failure) else 'network_error'
        if not re.fullmatch(r'[a-z0-9_:-]{1,100}', code):
            code = 'unexpected_error'
        if code == 'youtube_insert_wait':
            row.update(status='pending', error=None, _retry_at=max(self.global_retry, self.next_insert))
            self.store.save(row)
            return
        row['_attempts'] = row.get('_attempts', 0) + 1
        row['error'] = code
        if row['status'] != 'needs_review':
            row['status'] = 'failed'
        delay = min(3600, 30 * 2 ** min(row['_attempts'], 7)) + random.uniform(0, 15)
        if isinstance(error, UploadLimit):
            self.block_inserts(error)
            delay = max(1, error.retry_at - time.time())
            row['youtube_limit_reason'] = error.reason
            row['youtube_http_status'] = error.http_status
        if code.startswith('oauth_'):
            self.global_retry = time.time() + 600
        row['_retry_at'] = time.time() + delay
        self.store.save(row)
        log.warning('job-failed id=%s error=%s reason=%s retry=%s', row['id'], code,
                    row.get('youtube_limit_reason', '-'), datetime.fromtimestamp(row['_retry_at'], WIB).isoformat())

    async def uploads(self):
        while not self.stop.is_set():
            if self.scanned:
                pending = [r for r in self.rows.values() if upload_eligible(r) and r['id'] not in self.active and not r.get('_transfer_complete') and r['status'] != 'needs_review' and r.get('_retry_at', 0) <= time.time() and (r.get('_upload_url') or time.time() >= max(self.global_retry, self.next_insert))]
                # Resume interrupted uploads first, otherwise newest sessions first.
                pending.sort(key=lambda r: (not bool(r.get('_upload_url')), -(epoch(r['ended_at']) or 0), r['part']))
                if pending:
                    row = pending[0]
                    self.active.add(row['id'])
                    try:
                        row['status'] = 'uploading'
                        row['error'] = None
                        self.store.save(row)
                        log.info('upload-start id=%s name=%s bytes=%s', row['id'], clean(row['name']), row['bytes'])
                        await self.upload(row)
                        if row.get('_transfer_complete'):
                            await self.visibility(row)
                            log.info('upload-complete id=%s youtube=%s privacy=%s', row['id'], row['youtube_id'], row['youtube_privacy'])
                    except Exception as e:
                        self.failed(row, e)
                    finally:
                        self.active.discard(row['id'])
                    continue
            await self.wait(5)

    async def housekeeping(self):
        next_discovery = next_reconcile = 0
        while not self.stop.is_set():
            try:
                if time.time() >= next_discovery:
                    await self.discover()
                    next_discovery = time.time() + 300
                if not self.scanned or time.time() >= next_reconcile:
                    await self.reconcile()
                    next_reconcile = time.time() + 3600
                for row in list(self.rows.values()):
                    if row.get('_transfer_complete') and row.get('youtube_id') and row.get('_retry_at', 0) <= time.time():
                        try:
                            await self.visibility(row)
                        except Exception as e:
                            self.failed(row, e)
                # Publish privacy changes first. Do not issue one pending-state POST
                # for every backlog entry or let progress reports delay deadlines.
                dirty = [r for r in self.rows.values() if r.get('_dirty') and r['status'] != 'pending'][:10]
                for row in dirty:
                    if row.get('_dirty'):
                        await self.api('state', self.public(row))
                        row['_dirty'] = False
                        self.store.db.execute('UPDATE jobs SET value=? WHERE id=?', (json.dumps(row), row['id']))
                        self.store.db.commit()
            except Exception as e:
                log.warning('housekeeping-error code=%s', str(e) if isinstance(e, Failure) else 'network_error')
            await self.wait(30)

    async def wait(self, seconds):
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(self.stop.wait(), seconds)

    async def playback_checks(self):
        # Anonymous playback checks never block uploads, privacy deadlines or state publication.
        while not self.stop.is_set():
            candidates = [r for r in self.rows.values() if r.get('_transfer_complete') and r.get('processing_status') == 'succeeded' and r.get('_playback_check_at', 0) <= time.time() and not r.get('_dirty')]
            if candidates:
                row = min(candidates, key=lambda r: r.get('_playback_check_at', 0))
                row['_playback_check_at'] = time.time() + 1800
                try:
                    result = await self.api('playback', {'data_id': row['data_id'], 'run': row['run']}, timeout=100)
                    log.info('playback-check id=%s status=%s', row['id'], result.get('status', 'unknown'))
                except Exception as error:
                    log.warning('playback-check id=%s error=%s', row['id'], str(error) if isinstance(error, Failure) else 'network_error')
                self.store.save(row)
            await self.wait(20)

    async def sync_oauth(self):
        try:
            expected = os.environ.get('RECENT_YOUTUBE_CHANNEL_ID', 'UCTyCC-_QhsV01cN2CAzN3Fg')
            version = await sync_credentials(self.client, self.root, self.base, expected)
            if version and self.store.control('oauth_version').get('version') != version:
                recovered = 0
                for row in self.rows.values():
                    if (upload_eligible(row) and str(row.get('error') or '').startswith('oauth_')
                            and row['status'] != 'needs_review'):
                        row.update(error=None, status='uploaded' if row.get('_transfer_complete') else 'pending', _retry_at=0)
                        self.store.save(row)
                        recovered += 1
                self.global_retry = self.store.control('backoff').get('until', 0)
                self.youtube.access, self.youtube.until = None, 0
                self.store.control('oauth_version', {'version': version})
                log.info('oauth-credentials-updated retryable-jobs=%s', recovered)
        except Exception as error:
            code = str(error)
            if not re.fullmatch(r'oauth_sync_[a-z_0-9]{1,80}', code):
                code = 'oauth_sync_unavailable'
            log.warning('oauth-sync-error code=%s', code)

    async def oauth_updates(self):
        while not self.stop.is_set():
            await self.sync_oauth()
            await self.wait(30)

    async def run(self):
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, self.stop.set)
        async with AsyncSession(max_clients=6) as client, AsyncSession(max_clients=4, http_version=CurlHttpVersion.V1_1) as media_client:
            self.client, self.media_client = client, media_client
            self.youtube = RecentYouTube(client, self.store.save)
            await self.sync_oauth()
            await asyncio.gather(self.oauth_updates(), self.housekeeping(), self.uploads(), self.uploads(), self.playback_checks(), PlaylistManager(self).run())


if __name__ == '__main__':
    os.umask(0o077)
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    asyncio.run(Uploader().run())
