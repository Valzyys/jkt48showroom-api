"""Private audio-only relay. Called by the authenticated Cloudflare Worker.

No Spotify audio decryption or video playback. Spotify cookies are isolated to lyrics.
"""
import asyncio
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import base64
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, HTTPException, Request, Query
from fastapi.responses import JSONResponse, StreamingResponse, Response

from app import PublicMusic, VIDEO_ID, guess_track
from spotify_lyrics import SpotifyLyrics

TICKET = re.compile(r"^(\d{10})\.([A-Za-z0-9_-]{43})$")
RANGE = re.compile(r"^bytes=(?:\d+-\d*|-\d+)$")
MIME = {"m4a": "audio/mp4", "webm": "audio/webm"}
ORIGIN = "https://api.jkt48connect.app"


def audio_url(value):
    try:
        u = urlsplit(value)
        return u.scheme == "https" and bool(u.hostname) and u.hostname.endswith(".googlevideo.com") and u.port in (None, 443) and not (u.username or u.password) and u.path == "/videoplayback"
    except (ValueError, TypeError):
        return False


class AudioRelay:
    def __init__(self, token):
        self.secret = token.encode()
        self.spotify = SpotifyLyrics()
        self.music = PublicMusic(spotify=self.spotify)
        self.http = httpx.AsyncClient(timeout=httpx.Timeout(30, connect=8), limits=httpx.Limits(max_connections=12), follow_redirects=False, trust_env=False)
        self.extract_gate = asyncio.Semaphore(1)
        self.starts = []
        self.streams = 0

    async def close(self):
        tasks = list(self.music.inflight.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await self.spotify.close()
        await self.http.aclose()

    def ticket(self, video, ext, expires):
        message = f"music-audio-v1:{video}:{ext}:{expires}".encode()
        sig = base64.urlsafe_b64encode(hmac.digest(self.secret, message, "sha256")).decode().rstrip("=")
        return f"{expires}.{sig}"

    def verify(self, video, ext, ticket):
        match = TICKET.fullmatch(ticket)
        if not VIDEO_ID.fullmatch(video) or ext not in MIME or not match:
            raise HTTPException(400, "URL audio tidak valid.")
        expires = int(match[1])
        if expires <= time.time():
            raise HTTPException(410, "URL audio kedaluwarsa. Ambil detail lagu kembali.")
        if expires > time.time() + 1860 or not secrets.compare_digest(ticket, self.ticket(video, ext, expires)):
            raise HTTPException(403, "Tanda tangan audio tidak valid.")

    async def resolve(self, video):
        if not VIDEO_ID.fullmatch(video):
            raise HTTPException(400, "ID lagu tidak valid.")
        async def load():
            async with self.extract_gate:
                now = time.time()
                self.starts = [v for v in self.starts if v > now - 60]
                if len(self.starts) >= 10:
                    raise HTTPException(429, "Batas lookup audio tercapai. Coba sebentar lagi.")
                self.starts.append(now)
                binary = os.environ.get("MUSIC_EXTRACTOR", "/opt/jkt48-discord-music-tools/bin/yt-dlp")
                args = [binary, "--ignore-config", "--no-cache-dir", "--no-playlist", "--no-download", "--no-warnings", "--no-progress", "--socket-timeout", "8", "--retries", "0", "--extractor-retries", "0", "-f", "bestaudio[ext=m4a]/bestaudio", "--dump-single-json", "--", "https://www.youtube.com/watch?v=" + video]
                child_env = {"PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"), "LANG": "C.UTF-8"}
                for key in ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE"):
                    if os.environ.get(key):
                        child_env[key] = os.environ[key]
                proc = await asyncio.create_subprocess_exec(*args, env=child_env, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
                try:
                    raw, errors = await asyncio.wait_for(proc.communicate(), 40)
                except (asyncio.TimeoutError, asyncio.CancelledError) as exc:
                    if proc.returncode is None:
                        proc.kill()
                    await proc.wait()
                    if isinstance(exc, asyncio.CancelledError):
                        raise
                    raise HTTPException(504, "Lookup audio terlalu lama.") from exc
                if proc.returncode or len(raw) > 8 * 1024 * 1024:
                    raise HTTPException(503, "Audio anonim tidak tersedia dari sumber ini. Pilih versi lagu lain.")
                try:
                    d = json.loads(raw)
                except ValueError as exc:
                    raise HTTPException(502, "Respons sumber audio tidak valid.") from exc
                if d.get("id") != video or d.get("has_drm") or d.get("vcodec") != "none" or d.get("ext") not in MIME or not audio_url(d.get("url")):
                    raise HTTPException(502, "Sumber tidak memberikan stream audio-only yang valid.")
                if d.get("is_live") or d.get("age_limit", 0) > 0 or d.get("availability") not in ("public", None):
                    raise HTTPException(403, "Lagu memerlukan akses terbatas atau sedang live.")
                if not isinstance(d.get("duration"), (int, float)) or not 1 <= d["duration"] <= 10800:
                    raise HTTPException(400, "Durasi lagu tidak didukung (maksimal 3 jam).")
                headers = {"User-Agent": str((d.get("http_headers") or {}).get("User-Agent") or "Mozilla/5.0").replace("\r", "").replace("\n", "")[:400]}
                probe = await self.http.send(self.http.build_request("GET", d["url"], headers={**headers, "Range": "bytes=0-8191"}), stream=True)
                try:
                    if probe.status_code != 206 or not probe.headers.get("Content-Type", "").startswith("audio/"):
                        raise HTTPException(503, "Stream audio belum dapat diakses dari server.")
                    first = await anext(probe.aiter_bytes(8192), b"")
                    valid = first[4:8] == b"ftyp" if d["ext"] == "m4a" else first[:4] == b"\x1aE\xdf\xa3"
                    if not valid:
                        raise HTTPException(502, "Byte audio tidak cocok dengan formatnya.")
                    total_match = re.fullmatch(r"bytes 0-\d+/(\d+)", probe.headers.get("Content-Range", ""))
                    total = int(total_match[1]) if total_match else None
                    if not total or total > 160 * 1024 * 1024:
                        raise HTTPException(502, "Ukuran audio tidak didukung.")
                finally:
                    await probe.aclose()
                hint = (self.music.videos.get(video) or {}).get("lyrics_hint")
                title, artist = guess_track(d.get("title") or "", d.get("artist") or d.get("channel") or "")
                title = d.get("track") or (hint or {}).get("track") or title
                artist = d.get("artist") or (hint or {}).get("artist") or artist
                self.music.videos[video] = {"title": d.get("title") or title, "channel": artist, "duration": d["duration"], "lyrics_hint": {"track": title, "artist": artist}}
                self.music.videos.move_to_end(video)
                while len(self.music.videos) > 2048:
                    self.music.videos.popitem(last=False)
                return {"id": video, "title": title, "artist": artist, "album": d.get("album"), "version_title": d.get("title"), "duration": d["duration"], "ext": d["ext"], "codec": d.get("acodec"), "bytes": total, "source_url": d["url"], "headers": headers}
        return await self.music.cached(("audio", video), load, ttl=240)

    def present(self, data):
        expires = int(time.time()) + 1800
        ticket = self.ticket(data["id"], data["ext"], expires)
        return {"id": data["id"], "title": data["title"], "artist": data["artist"], "album": data["album"], "version_title": data["version_title"], "duration": data["duration"], "cover": f"https://i.ytimg.com/vi/{data['id']}/hqdefault.jpg", "source": {"platform": "youtube", "url": "https://www.youtube.com/watch?v=" + data["id"]}, "audio": {"status": "ready", "url": ORIGIN + f"/media/music/{data['id']}/{ticket}/audio.{data['ext']}", "format": data["ext"], "mime_type": MIME[data["ext"]], "codec": data["codec"], "has_video": False, "full_track": True, "bytes": data["bytes"], "seekable": True, "expires_at": expires}, "lyrics_url": ORIGIN + "/api/music/" + data["id"] + "/lyrics"}

    async def stream(self, request, video, ticket, ext):
        self.verify(video, ext, ticket)
        byte_range = request.headers.get("Range")
        if byte_range and not RANGE.fullmatch(byte_range):
            raise HTTPException(416, "Hanya satu HTTP byte range yang didukung.")
        if self.streams >= 8:
            raise HTTPException(429, "Relay audio sedang penuh.")
        self.streams += 1
        upstream = None
        try:
            data = await self.resolve(video)
            if data["ext"] != ext:
                raise HTTPException(410, "Format sumber berubah. Ambil detail lagu kembali.")
            headers = {**data["headers"]}
            if byte_range:
                headers["Range"] = byte_range
            upstream = await self.http.send(self.http.build_request("GET", data["source_url"], headers=headers), stream=True)
            if upstream.status_code == 416:
                headers = {"Content-Range": f"bytes */{data['bytes']}", "Cache-Control": "private, no-store"}
                await upstream.aclose()
                self.streams -= 1
                return Response(status_code=416, headers=headers)
            if upstream.status_code not in (200, 206) or (byte_range and upstream.status_code != 206) or not upstream.headers.get("Content-Type", "").startswith("audio/"):
                self.music.cache.pop(("audio", video), None)
                raise HTTPException(503, "Sumber audio berubah atau tidak tersedia. Ambil detail lagu kembali.")
            response_headers = {"Content-Type": MIME[ext], "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Accel-Buffering": "no", "X-Media-Storage": "audio-relay"}
            for name in ("Content-Length", "Content-Range"):
                if name in upstream.headers:
                    response_headers[name] = upstream.headers[name]
            status = upstream.status_code
            if request.method == "HEAD":
                await upstream.aclose()
                self.streams -= 1
                return Response(status_code=status, headers=response_headers)
            async def body():
                try:
                    async for chunk in upstream.aiter_bytes(65536):
                        yield chunk
                finally:
                    await upstream.aclose()
                    self.streams -= 1
            return StreamingResponse(body(), status_code=status, headers=response_headers)
        except BaseException:
            if upstream is not None:
                await upstream.aclose()
            self.streams -= 1
            raise


def create_app(token=None):
    token = token or os.environ.get("SCRAPER_TOKEN", "")
    if len(token) < 32:
        raise RuntimeError("SCRAPER_TOKEN belum dikonfigurasi.")
    @asynccontextmanager
    async def lifespan(app):
        app.state.relay = AudioRelay(token)
        yield
        await app.state.relay.close()
    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def auth(request, call_next):
        if request.url.path != "/health" and not secrets.compare_digest(request.headers.get("Authorization", ""), "Bearer " + token):
            return JSONResponse({"message": "Unauthorized"}, status_code=401)
        try:
            response = await call_next(request)
            response.headers["Cache-Control"] = "private, no-store"
            response.headers["X-Content-Type-Options"] = "nosniff"
            return response
        except httpx.HTTPError:
            return JSONResponse({"message": "Sumber audio sementara tidak tersedia."}, status_code=502)

    @app.get("/health")
    async def health():
        return {"ok": True, "service": "jkt48-music-api", "audio_only": True}

    @app.get("/api/v1/music/search")
    async def search(request: Request, q: str = Query(min_length=2, max_length=240), mode: str = Query(default="auto", pattern="^(auto|title|lyrics)$")):
        if len(q.strip()) < 2:
            raise HTTPException(400, "Masukkan minimal dua karakter.")
        result = await request.app.state.relay.music.search(q.strip(), mode)
        tracks = []
        for row in result["results"]:
            title, artist = guess_track(row["title"], row["channel"])
            hint = row.get("lyrics_hint") or {}
            tracks.append({"id": row["id"], "title": hint.get("track") or title, "artist": hint.get("artist") or artist, "version_title": row["title"], "duration": row["duration"], "cover": row["thumbnail"], "source": {"platform": "youtube", "url": row["url"]}, "audio": {"status": "on_demand", "details_url": ORIGIN + "/api/music/" + row["id"]}})
        return {"query": q, "identified_song": result.get("identified_song"), "tracks": tracks, "warning": result.get("warning"), "source_note": "Metadata Spotify opsional; audio berasal dari sumber publik YouTube, bukan decrypt Spotify."}

    @app.get("/api/v1/music/{video}/lyrics")
    async def lyrics(video: str, request: Request, track: str | None = Query(default=None, max_length=180), artist: str | None = Query(default=None, max_length=180)):
        if not VIDEO_ID.fullmatch(video):
            raise HTTPException(400, "ID lagu tidak valid.")
        relay = request.app.state.relay
        if video not in relay.music.videos and not (track and artist):
            await relay.resolve(video)
        return await relay.music.lyrics(video, track, artist)

    @app.get("/api/v1/music/{video}")
    async def detail(video: str, request: Request):
        relay = request.app.state.relay
        return relay.present(await relay.resolve(video))

    @app.api_route("/api/v1/music/media/{video}/{ticket}/audio.{ext}", methods=["GET", "HEAD"])
    async def media(video: str, ticket: str, ext: str, request: Request):
        if request.query_params:
            raise HTTPException(400, "Parameter audio tidak didukung.")
        return await request.app.state.relay.stream(request, video, ticket, ext)
    return app


app = create_app()
