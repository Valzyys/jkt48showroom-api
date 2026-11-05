"""Cookie-authenticated lyrics fallback; credentials never leave this provider."""
import asyncio
import http.cookiejar
import os
import stat
import time
import unicodedata
from pathlib import Path

from spotify_scraper import AsyncSpotifyClient, RateLimit, RetryPolicy
from spotify_scraper.errors import AuthenticationError, RateLimitedError, SpotifyScraperError


def normalized(value):
    return ''.join(c for c in unicodedata.normalize('NFKC', value).casefold() if c.isalnum())


def read_cookie(path):
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > 262144 or info.st_mode & 0o077:
        raise ValueError('private_cookie_required')
    jar = http.cookiejar.MozillaCookieJar(str(path))
    jar.load(ignore_discard=True, ignore_expires=False)
    for cookie in jar:
        domain = cookie.domain.lstrip('.').lower()
        if cookie.name == 'sp_dc' and (domain == 'spotify.com' or domain.endswith('.spotify.com')):
            value = cookie.value
            if value and len(value) < 8192 and not any(c.isspace() or c in ';\r\n' for c in value):
                return value
    raise ValueError('missing_cookie')


def select_track(tracks, title, artist, duration):
    matches = [t for t in tracks if normalized(t.name) == normalized(title)
               and any(normalized(a.name) == normalized(artist) for a in t.artists)]
    if duration is not None:
        matches = [t for t in matches if abs(t.duration_ms / 1000 - duration) <= 10]
        matches.sort(key=lambda t: abs(t.duration_ms / 1000 - duration))
    return matches[0] if matches else None


def present(track, lyrics, duration):
    lines = [{'time': line.start_ms / 1000, 'text': line.text} for line in lyrics.lines
             if line.start_ms >= 0 and line.text.strip()]
    if lyrics.sync_type != 'LINE_SYNCED' or len({line['time'] for line in lines}) < 2:
        return None
    delta = abs(track.duration_ms / 1000 - duration) if duration is not None else None
    return {'status': 'synced', 'source': 'spotify', 'id': track.id, 'spotify_id': track.id,
            'track': track.name, 'artist': ', '.join(a.name for a in track.artists),
            'duration': track.duration_ms / 1000, 'duration_difference_seconds': delta,
            'alignment': 'duration_matches' if delta is not None and delta <= 3 else 'needs_check',
            'sync_type': lyrics.sync_type, 'provider': lyrics.provider, 'language': lyrics.language,
            'lines': sorted(lines, key=lambda line: line['time']), 'plain_lyrics': None,
            'note': 'Versi MV/live dapat memiliki intro berbeda. Gunakan pengaturan offset bila diperlukan.'}


class SpotifyLyrics:
    def __init__(self):
        directory = os.environ.get('CREDENTIALS_DIRECTORY')
        self.path = Path(directory) / 'spotify-cookies' if directory else Path(os.environ.get('SPOTIFY_COOKIES_FILE', '/etc/jkt48-spotify-cookies.txt'))
        self.client = None
        self.fingerprint = None
        self.lock = asyncio.Lock()
        self.until = 0
        self.reason = 'temporarily_unavailable'

    async def close(self):
        if self.client:
            await self.client.aclose()
            self.client = None

    async def lookup(self, title, artist, duration=None):
        async with self.lock:
            try:
                info = self.path.stat()
                fingerprint = (info.st_ino, info.st_mtime_ns, info.st_size)
                if fingerprint != self.fingerprint:
                    await self.close()
                    cookie = read_cookie(self.path)
                    self.client = AsyncSpotifyClient(cookies={'sp_dc': cookie}, timeout=8,
                        rate_limit=RateLimit(per_second=1, burst=1), max_concurrency=1,
                        retry=RetryPolicy(max_attempts=1, backoff_max=0))
                    self.fingerprint = fingerprint
                    self.until = 0
            except FileNotFoundError:
                return None, 'not_configured'
            except (OSError, ValueError, http.cookiejar.LoadError):
                return None, 'cookie_invalid'
            if self.until > time.monotonic():
                return None, self.reason
            try:
                async def request():
                    results = await self.client.search(title + ' ' + artist, types=('track',), limit=5)
                    track = select_track(results.tracks, title, artist, duration)
                    if not track:
                        return None, 'not_found'
                    lyrics = await self.client.get_lyrics(track.id)
                    result = present(track, lyrics, duration)
                    return result, 'synced' if result else 'unsynced'
                return await asyncio.wait_for(request(), 25)
            except AuthenticationError:
                self.reason, delay = 'authentication_failed', 600
            except RateLimitedError as exc:
                self.reason, delay = 'rate_limited', min(3600, max(60, float(exc.retry_after or 60)))
            except (SpotifyScraperError, asyncio.TimeoutError, OSError, ValueError):
                self.reason, delay = 'temporarily_unavailable', 60
            self.until = time.monotonic() + delay
            return None, self.reason
