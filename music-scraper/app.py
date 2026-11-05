"""Anonymous metadata discovery for the audio-only Music API.

Spotify supplies public oEmbed metadata only, never decrypted Spotify audio.
"""
import asyncio
import json
import re
import time
from collections import OrderedDict, deque
from urllib.parse import urlencode, urlsplit

from fastapi import HTTPException

UA = "JKT48ConnectMusic/1.0 (https://api.jkt48connect.app)"
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


def text(value):
    return value.get("simpleText") or "".join(x.get("text", "") for x in value.get("runs", []))


def youtube_results(page):
    match = re.search(r"(?:var\s+ytInitialData|window\[\"ytInitialData\"\]|ytInitialData)\s*=\s*", page)
    if not match:
        raise HTTPException(502, "Pencarian YouTube tidak tersedia; coba lagi nanti.")
    try:
        data, _ = json.JSONDecoder().raw_decode(page[match.end():])
    except ValueError as exc:
        raise HTTPException(502, "Format pencarian YouTube berubah.") from exc
    found = OrderedDict()
    for node in walk(data):
        video = node.get("videoRenderer")
        if not isinstance(video, dict) or not VIDEO_ID.fullmatch(video.get("videoId", "")):
            continue
        ident = video["videoId"]
        length = text(video.get("lengthText", {}))
        parts = length.split(":")
        duration = 0
        if parts and all(x.isdigit() for x in parts):
            for x in parts:
                duration = duration * 60 + int(x)
        # Music discovery must not accidentally choose an ongoing live stream.
        if not duration:
            continue
        found.setdefault(ident, {
            "id": ident, "title": text(video.get("title", {})),
            "channel": text(video.get("ownerText", {})), "duration": duration,
            "thumbnail": f"https://i.ytimg.com/vi/{ident}/hqdefault.jpg",
            "source": "youtube", "url": f"https://www.youtube.com/watch?v={ident}",
        })
    return list(found.values())[:12]


def parse_lrc(raw):
    lines = []
    offset = re.search(r"\[offset:([+-]?\d+)\]", raw or "", re.I)
    shift = int(offset[1]) / 1000 if offset else 0
    for line in (raw or "").splitlines():
        stamps = re.findall(r"\[(\d{1,3}):(\d{2}(?:[.:]\d{1,3})?)\]", line)
        body = re.sub(r"\[[^\]]*\]", "", line).strip()
        for minute, second in stamps:
            lines.append({"time": max(0, int(minute) * 60 + float(second.replace(":", ".")) + shift), "text": body})
    return sorted(lines, key=lambda row: row["time"])


def guess_track(title, channel):
    title = title.split("|", 1)[0]
    title = re.sub(r"\s*\+\s*lyrics?.*$", "", title, flags=re.I)
    title = re.sub(r"\([^)]*(?:official|video|lyrics?|audio|MV|HD|4K)[^)]*\)|\[[^]]*\]", "", title, flags=re.I)
    title = re.sub(r"\b(?:official\s+(?:music\s+)?(?:video|audio)|lyrics?\s+video)\b", "", title, flags=re.I).strip()
    artist = re.sub(r"(?:\s*-\s*Topic|VEVO|Official)$", "", channel, flags=re.I).strip()
    parts = re.split(r"\s+[-–—]\s+", title, maxsplit=1)
    if len(parts) == 2:
        artist, title = parts
    return title.strip(' "“”'), artist.strip()


class PublicMusic:
    def __init__(self, spotify=None):
        self.spotify = spotify
        self.cache = OrderedDict()
        self.inflight = {}
        self.gate = asyncio.Semaphore(3)
        self.lyrics_gate = asyncio.Lock()
        self.lyrics_last = 0
        self.videos = OrderedDict()

    async def fetch(self, host, path, params):
        # All hosts and paths are supplied by this module, never by user input.
        assert host in {"www.youtube.com", "lrclib.net", "open.spotify.com", "genius.com"}
        url = "https://" + host + path + "?" + urlencode(params)
        async with self.gate:
            proc = await asyncio.create_subprocess_exec(
                "curl", "--silent", "--show-error", "--max-time", "18", "--max-filesize", "4194304",
                "--proto", "=https", "--user-agent", UA, "--write-out", "\n%{http_code}", url,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            )
            try:
                body, _ = await asyncio.wait_for(proc.communicate(), 20)
            except (asyncio.TimeoutError, asyncio.CancelledError) as exc:
                if proc.returncode is None:
                    proc.kill()
                await proc.wait()
                if isinstance(exc, asyncio.CancelledError):
                    raise
                raise HTTPException(504, "Sumber musik terlalu lama merespons.") from exc
        if proc.returncode:
            raise HTTPException(502, f"Sumber {host} tidak dapat dihubungi.")
        payload, _, code = body.rpartition(b"\n")
        if code == b"404":
            return None
        if code != b"200":
            raise HTTPException(503 if code == b"429" else 502, f"Sumber {host} mengembalikan HTTP {code.decode(errors='replace')}.")
        return payload.decode("utf-8", errors="replace")

    async def cached(self, key, loader, ttl=300):
        now = time.monotonic()
        old = self.cache.get(key)
        if old and old[0] > now:
            self.cache.move_to_end(key)
            return old[1]
        if key not in self.inflight:
            if len(self.inflight) >= 12:
                raise HTTPException(429, "Pencarian sedang penuh. Coba sebentar lagi.")
            async def run():
                try:
                    result = await loader()
                    self.cache[key] = (time.monotonic() + (ttl(result) if callable(ttl) else ttl), result)
                    self.cache.move_to_end(key)
                    while len(self.cache) > 256:
                        self.cache.popitem(last=False)
                    return result
                finally:
                    self.inflight.pop(key, None)
            self.inflight[key] = asyncio.create_task(run())
        return await asyncio.shield(self.inflight[key])

    async def lyrics_request(self, path, params):
        async with self.lyrics_gate:
            await asyncio.sleep(max(0, 0.4 - (time.monotonic() - self.lyrics_last)))
            try:
                raw = await self.fetch("lrclib.net", path, params)
                return json.loads(raw) if raw else None
            finally:
                self.lyrics_last = time.monotonic()

    async def search(self, query, mode="auto"):
        async def load():
            spotify = None
            identified = None
            resolver_warning = None
            lookup = query
            if query.startswith(("https://", "http://")):
                u = urlsplit(query)
                if u.scheme != "https" or u.hostname != "open.spotify.com" or not re.fullmatch(r"/(?:intl-[a-z]+/)?track/[A-Za-z0-9]{22}", u.path):
                    raise HTTPException(400, "Gunakan judul/potongan lirik atau URL track Spotify yang valid.")
                raw = await self.fetch("open.spotify.com", "/oembed", {"url": "https://open.spotify.com" + u.path})
                spotify = json.loads(raw) if raw else None
                if not spotify or not spotify.get("title"):
                    raise HTTPException(404, "Track Spotify tidak ditemukan.")
                lookup = spotify["title"]
            elif mode in {"lyrics", "auto"}:
                try:
                    raw = await self.fetch("genius.com", "/api/search/lyrics" if mode == "lyrics" else "/api/search/multi", {"q": query, "per_page": 3})
                    sections = json.loads(raw or '{}').get("response", {}).get("sections", [])
                    priority = {"top_hit": 0, "song": 1, "lyric": 2}
                    sections = sorted((s for s in sections if s.get("type") in priority), key=lambda s: priority[s["type"]])
                    hits = [h.get("result", {}) for section in sections for h in section.get("hits", []) if h.get("type") == "song"]
                    if hits:
                        hit = hits[0]
                        performer = (hit.get("primary_artist") or {}).get("name")
                        if hit.get("title") and performer:
                            identified = {"track": hit["title"], "artist": performer, "source": "genius_public_search", "url": hit.get("url"), "needs_confirmation": True}
                            lookup = performer + " " + hit["title"]
                except (HTTPException, ValueError):
                    resolver_warning = "Pengenalan potongan lirik tidak tersedia; memakai pencarian teks biasa."
            page = await self.fetch("www.youtube.com", "/results", {"search_query": lookup + " official audio", "hl": "en"})
            items = youtube_results(page or "")
            for row in items:
                if identified:
                    normalize = lambda s: re.sub(r"[^\w]+", " ", s.casefold()).strip()
                    title_matches = normalize(identified["track"]) in normalize(row["title"])
                    artist_matches = normalize(identified["artist"]) in normalize(row["title"] + " " + row["channel"])
                    if title_matches and artist_matches:
                        row["lyrics_hint"] = {"track": identified["track"], "artist": identified["artist"]}
                self.videos[row["id"]] = row
                self.videos.move_to_end(row["id"])
            while len(self.videos) > 2048:
                self.videos.popitem(last=False)
            return {"query": query, "source": "youtube_public_search", "spotify_metadata": spotify, "identified_song": identified, "warning": resolver_warning,
                    "results": items, "note": "Hasil potongan lirik mengikuti kecocokan pencarian YouTube. Audio penuh berasal dari YouTube, bukan Spotify."}
        return await self.cached(("search", mode, query if query.startswith("https://") else query.casefold()), load)

    async def lyrics(self, video, track=None, artist=None):
        row = self.videos.get(video)
        if not row and not (track and artist):
            raise HTTPException(404, "Cari lagu terlebih dahulu atau isi track dan artist.")
        guessed = guess_track(row["title"], row["channel"]) if row else (track, artist)
        if row and row.get("lyrics_hint"):
            guessed = (row["lyrics_hint"]["track"], row["lyrics_hint"]["artist"])
        title, performer = track or guessed[0], artist or guessed[1]
        async def load():
            original_error = None
            try:
                result = await self.lyrics_request("/api/get", {"track_name": title, "artist_name": performer})
            except (HTTPException, ValueError) as exc:
                original_error = exc
                result = None
            if self.spotify and not (result and (result.get("instrumental") or len({line["time"] for line in parse_lrc(result.get("syncedLyrics"))}) >= 2)):
                fallback, status = await self.spotify.lookup(title, performer, row["duration"] if row else None)
                if fallback:
                    return fallback
            else:
                status = None
            if original_error:
                raise original_error
            if not result:
                return {"status": "not_found", "source": "lrclib", "lines": [], "track": title, "artist": performer, "fallback": {"source": "spotify", "status": status} if status else None}
            lines = parse_lrc(result.get("syncedLyrics"))
            # A single timestamp for an entire song is not synchronized lyrics.
            if len({line["time"] for line in lines}) < 2:
                lines = []
            delta = abs(float(result.get("duration") or 0) - row["duration"]) if row else None
            return {"status": "synced" if lines else "instrumental" if result.get("instrumental") else "unsynced",
                    "source": "lrclib", "fallback": {"source": "spotify", "status": status} if status else None, "id": result["id"], "track": result.get("trackName"),
                    "artist": result.get("artistName"), "duration": result.get("duration"),
                    "duration_difference_seconds": delta, "alignment": "needs_check" if delta is None or delta > 3 else "duration_matches",
                    "lines": lines, "plain_lyrics": result.get("plainLyrics") if not lines else None,
                    "note": "Versi MV/live dapat memiliki intro berbeda. Gunakan pengaturan offset bila diperlukan."}
        return await self.cached(("lyrics", video, title.casefold(), performer.casefold()), load, ttl=lambda value: 3600 if value.get("status") in {"synced", "instrumental"} else 120)
