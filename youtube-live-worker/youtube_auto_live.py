#!/usr/bin/env python3
"""YouTube Auto Live worker (VPS / systemd).

One persistent process. Polls the control panel every ~7s (HMAC-signed), and runs at most ONE relay:
HLS -> FFmpeg -> YouTube RTMPS. YouTube OAuth secrets live only in this server's environment.
Nothing is written to disk except a tiny state file per job (no video).
"""
import asyncio, contextlib, datetime as dt, hashlib, hmac, json, os, re, secrets, signal, socket, ipaddress, sys, time
from pathlib import Path
from urllib.parse import urlparse, urljoin
import httpx
from credential_sync import load_credentials, sync_credentials

VERSION = "1.0.1-audio"
API = os.environ.get("CONTROL_URL", "").rstrip("/")            # e.g. https://st.avonera48.web.id
TOKEN = os.environ.get("YT_WORKER_TOKEN", "")
STATE = Path(os.environ.get("YOUTUBE_LIVE_STATE", "/var/lib/jkt48-youtube-live"))
FFMPEG = os.environ.get("FFMPEG_BIN", "/usr/bin/ffmpeg")
ALLOWED = {h.strip().lower() for h in os.environ.get("HLS_ALLOWED_HOSTS", "test-streams.mux.dev").split(",") if h.strip()}
YT = "https://www.googleapis.com/youtube/v3/"
TEST_MAX = 600
OSHI_SOURCE = None


class SafeError(Exception):
    pass


def scrub(s):
    s = re.sub(r"rtmps?://\S+", "[rtmp]", str(s))
    s = re.sub(r"https?://([^\s/?#]+)\S*", r"[url:\1]", s)
    return re.sub(r"[A-Za-z0-9_\-+/=]{32,}", "[redacted]", s)[:300]


# ---------------- control plane client ----------------
class Control:
    def __init__(self, client):
        self.c = client

    async def call(self, action, body=None):
        from email.utils import parsedate_to_datetime
        raw = json.dumps(body or {}, separators=(",", ":"))
        path = f"/api/public/yt-worker/{action}"
        for attempt in range(2):
            ts = str(int((time.time() + getattr(self, "clock_offset", 0)) * 1000))
            nonce = secrets.token_hex(16)
            msg = f"{ts}.{nonce}.POST.{path}.{hashlib.sha256(raw.encode()).hexdigest()}"
            sig = hmac.new(TOKEN.encode(), msg.encode(), hashlib.sha256).hexdigest()
            started = time.time()
            r = await self.c.post(API + path, content=raw, headers={
                "content-type": "application/json", "x-ts": ts, "x-nonce": nonce, "x-signature": sig})
            ended = time.time()
            # Bounded clock correction from configured HTTPS server; never weaken HMAC validation.
            if attempt == 0 and r.status_code == 401 and r.headers.get("date"):
                try:
                    offset = parsedate_to_datetime(r.headers["date"]).timestamp() - (started + ended) / 2
                    if 5 < abs(offset - getattr(self, "clock_offset", 0)) <= 120 and abs(offset) <= 120:
                        self.clock_offset = offset
                        print(json.dumps({"level":"info","event":"control_clock_adjusted","offset_seconds":round(offset,1)}),flush=True)
                        continue
                except (ValueError, TypeError, OverflowError):
                    pass
            try:
                data = r.json()
            except Exception:
                data = {}
            return r.status_code, data
        return r.status_code, {}

    async def report(self, job_id, **fields):
        logs = fields.pop("logs", None)
        body = {"job_id": job_id, **fields}
        if logs:
            body["logs"] = [{"level": l, "message": scrub(m)} for l, m in logs]
        with contextlib.suppress(Exception):
            return (await self.call("report", body))[1]
        return {}


# ---------------- source validation (SSRF guard) ----------------
def host_ok(url, extra=()):
    u = urlparse(url)
    h = (u.hostname or "").lower()
    if u.scheme != "https" or u.username or u.password or not h:
        return False
    if not (h in ALLOWED or h in extra or any(h.endswith("." + a) for a in ALLOWED)):
        return False
    try:
        for info in socket.getaddrinfo(h, 443):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return False
    except socket.gaierror:
        return False
    return True


async def pick_variant(client, url):
    """Return (best variant url <=1080p, height, is_vod). Never upscales; reports real height."""
    if not host_ok(url):
        raise SafeError("hls_source_host_denied")
    r = await client.get(url, follow_redirects=False)
    if r.status_code != 200:
        raise SafeError(f"hls_source_http_{r.status_code}")
    if len(r.content) > 1024 * 1024:
        raise SafeError("hls_manifest_too_large")
    text = r.text
    if not text.lstrip().startswith("#EXTM3U"):
        raise SafeError("invalid_hls_manifest")
    lines = text.splitlines()
    variants = []
    for i, line in enumerate(lines):
        if line.startswith("#EXT-X-STREAM-INF:"):
            m = re.search(r"RESOLUTION=(\d+)x(\d+)", line)
            uri = next((v.strip() for v in lines[i + 1:] if v.strip() and not v.startswith("#")), None)
            if uri:
                variants.append((int(m[2]) if m else 0, urljoin(url, uri)))
    height, chosen = None, url
    ok = [v for v in variants if v[0] <= 1080]
    if ok:
        height, chosen = max(ok, key=lambda v: v[0])
        height = height or None
        if not host_ok(chosen, extra={(urlparse(url).hostname or "").lower()}):
            raise SafeError("hls_variant_host_denied")
    media = text if not variants else (await client.get(chosen, follow_redirects=False)).text[:1024 * 1024]
    return chosen, height, "#EXT-X-ENDLIST" in media


async def is_moving_live(client, url):
    """Live = no ENDLIST and media sequence advances between two reads."""
    try:
        chosen, _, vod = await pick_variant(client, url)
        if vod:
            return False
        seq = lambda t: int((re.search(r"#EXT-X-MEDIA-SEQUENCE:(\d+)", t) or [0, -1])[1])
        a = seq((await client.get(chosen)).text)
        await asyncio.sleep(8)
        b = seq((await client.get(chosen)).text)
        return b > a or a == -1
    except Exception:
        return False


# ---------------- YouTube API ----------------
class YouTube:
    def __init__(self, client):
        self.c, self.access = client, None

    async def token(self):
        saved = await asyncio.to_thread(load_credentials, STATE)
        credentials = saved["credentials"] if saved else {
            "client_id": os.environ["YOUTUBE_CLIENT_ID"], "client_secret": os.environ["YOUTUBE_CLIENT_SECRET"],
            "refresh_token": os.environ["YOUTUBE_REFRESH_TOKEN"]}
        r = await self.c.post("https://oauth2.googleapis.com/token", data={**credentials, "grant_type": "refresh_token"})
        if r.status_code != 200:
            raise SafeError(f"oauth_refresh_failed_{r.status_code}")
        self.access = r.json()["access_token"]

    async def call(self, method, resource, params=None, body=None):
        for attempt in range(2):
            if not self.access:
                await self.token()
            r = await self.c.request(method, YT + resource, params=params, json=body,
                                     headers={"Authorization": "Bearer " + self.access})
            if r.status_code == 401 and attempt == 0:
                self.access = None
                continue
            if r.status_code not in (200, 201, 204):
                reason = ""
                with contextlib.suppress(Exception):
                    reason = r.json()["error"]["errors"][0]["reason"]
                raise SafeError(f"youtube_{resource.split('/')[0]}_http_{r.status_code}{('_' + reason) if reason else ''}")
            return {} if r.status_code == 204 else r.json()
        raise SafeError("youtube_auth_failed")


# ---------------- relay ----------------
class Relay:
    def __init__(self, job, settings, ctl):
        self.job, self.settings, self.ctl = job, settings, ctl
        self.id = job["id"]
        self.test = job["kind"] == "test"
        self.stop = asyncio.Event()
        self.restart = asyncio.Event()
        self.proc = None
        self.root = STATE / self.id
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.state_file = self.root / "state.json"
        self.state = json.loads(self.state_file.read_text()) if self.state_file.exists() else {}

    def save(self, **kv):
        self.state.update(kv)
        tmp = self.root / "state.tmp"
        tmp.write_text(json.dumps(self.state))
        tmp.chmod(0o600)
        tmp.replace(self.state_file)

    async def source(self, client):
        if not self.test and OSHI_SOURCE:
            return await OSHI_SOURCE.source()
        code, data = await self.ctl.call("source", {"job_id": self.id})
        if code == 404:
            return None
        if code != 200 or not data.get("url"):
            raise SafeError(f"source_unavailable_{code}")
        host = (urlparse(data["url"]).hostname or "").lower()
        if not self.test:
            ALLOWED.add(host)  # prod host comes from the trusted control plane (IDN resolver)
        return await pick_variant(client, data["url"])

    def ffmpeg_cmd(self, url, target, remaining):
        ff = [FFMPEG, "-hide_banner", "-nostdin", "-loglevel", "error", "-progress", "pipe:1", "-stats_period", "5",
              "-rw_timeout", "20000000", "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
              "-user_agent", "Mozilla/5.0", "-thread_queue_size", "512", "-fflags", "+genpts+discardcorrupt", *([] if self.test else ["-live_start_index", "-7"]), "-re", "-i", url, "-t", str(int(remaining)), "-map", "0:v:0", "-map", "0:a:0?"]
        if self.settings.get("encode"):
            ff += ["-vf", "fps=30", "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-g", "60",
                   "-keyint_min", "60", "-sc_threshold", "0", "-pix_fmt", "yuv420p", "-b:v", "6000k", "-maxrate", "8000k",
                   "-bufsize", "16000k"]
        else:
            ff += ["-c:v", "copy"]
        # Rebuild AAC frames and repair HLS audio timestamp discontinuities.
        # Video copy preserves source resolution without unnecessary encoding.
        ff += ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
               "-af", "aresample=48000:async=100:first_pts=0", "-max_muxing_queue_size", "1024"]
        return ff + ["-max_interleave_delta", "500000", "-flush_packets", "1", "-flvflags", "no_duration_filesize", "-f", "flv", target]

    async def read_progress(self):
        stats = {}
        last_log = 0
        while self.proc and self.proc.stdout:
            line = await self.proc.stdout.readline()
            if not line:
                break
            k, _, v = line.decode(errors="ignore").strip().partition("=")
            if k == "bitrate" and v.endswith("kbits/s"):
                with contextlib.suppress(ValueError):
                    stats["bitrate_kbps"] = round(float(v[:-7]))
            elif k == "speed":
                stats["speed"] = v.rstrip("x")
            elif k == "fps":
                stats["fps"] = v
            elif k in ("frame", "out_time_us", "dup_frames", "drop_frames"):
                with contextlib.suppress(ValueError):
                    stats[k] = int(v)
            elif k == "progress":
                self.last_stats = dict(stats)
                if time.monotonic() - last_log >= 30:
                    print(json.dumps({"event": "relay_progress", **stats}), flush=True)
                    last_log = time.monotonic()

    async def probe_video(self, url):
        p = await asyncio.create_subprocess_exec(
            FFMPEG.replace("ffmpeg", "ffprobe"), "-v", "error", "-select_streams", "v:0", "-show_entries",
            "stream=width,height,avg_frame_rate", "-of", "json", url, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        with contextlib.suppress(Exception):
            out, _ = await asyncio.wait_for(p.communicate(), 30)
            s = json.loads(out)["streams"][0]
            n, d = (s.get("avg_frame_rate") or "0/1").split("/")
            return {"width": s.get("width"), "height": s.get("height"), "fps": round(int(n) / max(int(d), 1), 2)}
        with contextlib.suppress(Exception):
            p.kill()
        return None

    async def start_ffmpeg(self, client, target, deadline):
        src = await self.source(client)
        if not src:
            return False
        url, height, vod = src
        if vod and not self.test:
            raise SafeError("source_is_vod_not_live")
        video = await self.probe_video(url)
        await self.ctl.report(self.id, source_height=(video or {}).get("height") or height,
                              stats={"video": video} if video else None,
                              logs=[("info", f"Sumber dipilih: {(video or {}).get('height') or height or '?'}p" + (" (VOD/tes)" if vod else ""))])
        self.last_stats = {}
        self.proc = await asyncio.create_subprocess_exec(*self.ffmpeg_cmd(url, target, max(deadline - time.time(), 30)),
                                                         stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        asyncio.create_task(self.read_progress())
        asyncio.create_task(self.read_errors(self.proc))
        return True

    async def read_errors(self, proc):
        last_log = 0
        while proc.stderr:
            line = await proc.stderr.readline()
            if not line:
                break
            if time.monotonic() - last_log >= 30:
                print(json.dumps({"level": "warn", "event": "ffmpeg_audio_relay",
                                  "message": scrub(line.decode(errors="replace").strip())}), flush=True)
                last_log = time.monotonic()

    async def kill_ffmpeg(self):
        if self.proc and self.proc.returncode is None:
            self.proc.terminate()
            try:
                await asyncio.wait_for(self.proc.wait(), 15)
            except asyncio.TimeoutError:
                self.proc.kill()
                await self.proc.wait()

    async def run(self):
        s = self.settings
        limit = TEST_MAX if self.test else int(s.get("max_duration_min") or 360) * 60
        deadline = time.time() + limit
        was_live = False
        bid, sid = self.state.get("broadcast_id"), self.state.get("stream_id")
        async with httpx.AsyncClient(timeout=30) as client:
            yt = YouTube(client)
            try:
                await self.ctl.report(self.id, status="starting", logs=[("info", "Worker mulai menyiapkan siaran")])
                if bid:  # reconcile after a worker restart: reuse if still usable
                    b = (await yt.call("GET", "liveBroadcasts", {"part": "status", "id": bid})).get("items") or []
                    if not b or b[0]["status"]["lifeCycleStatus"] in ("complete", "revoked"):
                        raise SafeError("previous_broadcast_closed_manual_review")
                    was_live = b[0]["status"]["lifeCycleStatus"] == "live"
                if not self.test:
                    # make sure the source really is live before creating anything on YouTube
                    if OSHI_SOURCE:
                        if not await OSHI_SOURCE.source():
                            raise SafeError("source_not_live")
                    else:
                        code, data = await self.ctl.call("source", {"job_id": self.id})
                        if code == 404:
                            raise SafeError("source_not_live")
                if not bid:
                    title = self.job.get("title") or s.get("title") or "Live"
                    if not self.test and OSHI_SOURCE:
                        title, schedule_id = await OSHI_SOURCE.title()
                        self.save(schedule_id=schedule_id, title=title)
                        await self.ctl.report(self.id, logs=[("info", "Judul jadwal theater: " + title)])
                    desc = "TEST relay HLS Mux (video sampel, bukan pertunjukan)." if self.test else (s.get("description") or "")
                    b = await yt.call("POST", "liveBroadcasts", {"part": "snippet,status,contentDetails"}, {
                        "snippet": {"title": title[:100], "description": desc[:4500],
                                    "scheduledStartTime": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=30)).isoformat()},
                        "status": {"privacyStatus": "unlisted", "selfDeclaredMadeForKids": False},
                        "contentDetails": {"enableEmbed": True, "enableDvr": True, "recordFromStart": True,
                                           "enableAutoStart": False, "enableAutoStop": False,
                                           "monitorStream": {"enableMonitorStream": False}}})
                    bid = b["id"]
                    self.save(broadcast_id=bid)
                    await self.ctl.report(self.id, broadcast_id=bid, privacy="unlisted")
                if not sid:
                    st = await yt.call("POST", "liveStreams", {"part": "snippet,cdn,contentDetails"}, {
                        "snippet": {"title": self.id}, "cdn": {"frameRate": "variable", "resolution": "variable", "ingestionType": "rtmp"},
                        "contentDetails": {"isReusable": False}})
                    sid = st["id"]
                    self.save(stream_id=sid)
                    await yt.call("POST", "liveBroadcasts/bind", {"part": "id", "id": bid, "streamId": sid})
                    await self.ctl.report(self.id, stream_id=sid)
                st = (await yt.call("GET", "liveStreams", {"part": "cdn,status", "id": sid}))["items"][0]
                ing = st["cdn"]["ingestionInfo"]
                target = ing["rtmpsIngestionAddress"].rstrip("/") + "/" + ing["streamName"]
                if not await self.start_ffmpeg(client, target, deadline):
                    raise SafeError("source_not_live")
                if not was_live:
                    for _ in range(36):
                        if self.stop.is_set():
                            raise SafeError("cancelled")
                        if self.proc.returncode is not None:
                            raise SafeError("ffmpeg_stopped_before_live")
                        r = (await yt.call("GET", "liveStreams", {"part": "status", "id": sid}))["items"][0]
                        if r["status"]["streamStatus"] == "active":
                            break
                        await asyncio.sleep(5)
                    else:
                        raise SafeError("ingestion_timeout")
                    await yt.call("POST", "liveBroadcasts/transition", {"part": "status", "id": bid, "broadcastStatus": "live"})
                    for _ in range(24):
                        b = (await yt.call("GET", "liveBroadcasts", {"part": "status,contentDetails", "id": bid}))["items"][0]
                        if b["status"]["lifeCycleStatus"] == "live":
                            if b["status"]["privacyStatus"] != "unlisted" or not b["contentDetails"].get("enableEmbed"):
                                raise SafeError("privacy_or_embed_mismatch")
                            was_live = True
                            break
                        await asyncio.sleep(5)
                    if not was_live:
                        raise SafeError("live_transition_timeout")
                self.save(was_live=True)
                await self.ctl.report(self.id, status="live", error=None, logs=[("info", "YouTube terverifikasi LIVE")])

                gaps = 0
                while not self.stop.is_set() and time.time() < deadline:
                    with contextlib.suppress(asyncio.TimeoutError):
                        await asyncio.wait_for(self.stop.wait(), 15)
                    if self.stop.is_set():
                        break
                    if self.restart.is_set() or self.proc.returncode is not None:
                        manual = self.restart.is_set()
                        self.restart.clear()
                        await self.kill_ffmpeg()
                        if self.test and not manual:
                            break  # VOD test finished naturally
                        await self.ctl.report(self.id, status="reconnecting", logs=[("warn", "Restart relay manual" if manual else "FFmpeg berhenti, menyambung ulang ke broadcast yang sama")])
                        if await self.start_ffmpeg(client, target, deadline):
                            gaps = 0
                            await self.ctl.report(self.id, status="live")
                        else:
                            gaps += 1
                            if gaps >= 6:  # ~2-3 minutes offline = show really ended
                                await self.ctl.report(self.id, logs=[("info", "Sumber berakhir")])
                                break
                            await asyncio.sleep(10)
                        continue
                    health = {}
                    with contextlib.suppress(Exception):
                        r = (await yt.call("GET", "liveStreams", {"part": "status", "id": sid}))["items"][0]
                        health = r["status"].get("healthStatus", {})
                    reply = await self.ctl.report(self.id, stats={**getattr(self, "last_stats", {}), "health": {"status": health.get("status")}})
                    if reply and reply.get("stop_requested"):
                        self.stop.set()
                await self.ctl.report(self.id, status="stopping")
                ok = await self.cleanup(yt, bid, sid, was_live)
                await self.ctl.report(self.id, status="completed", cleanup_ok=ok, logs=[("info", "Siaran selesai, ingestion dihapus" if ok else "Selesai, tapi cleanup YouTube gagal — cek manual")])
            except Exception as exc:
                msg = str(exc) if isinstance(exc, SafeError) else type(exc).__name__
                ok = await self.cleanup(yt, bid, sid, was_live)
                await self.ctl.report(self.id, status="completed" if msg == "cancelled" else "failed",
                                      error=None if msg == "cancelled" else msg, cleanup_ok=ok,
                                      logs=[("error" if msg != "cancelled" else "info", msg)])
            finally:
                self.save(finished=True)

    async def cleanup(self, yt, bid, sid, was_live):
        await self.kill_ffmpeg()
        ok = True
        if bid:
            try:
                if was_live:
                    await yt.call("POST", "liveBroadcasts/transition", {"part": "id", "id": bid, "broadcastStatus": "complete"})
                else:
                    await yt.call("DELETE", "liveBroadcasts", {"id": bid})
            except Exception:
                ok = False
        if sid:
            try:
                await yt.call("DELETE", "liveStreams", {"id": sid})
            except Exception:
                ok = False
        return ok


# ---------------- scheduler loop ----------------
async def main():
    global OSHI_SOURCE
    if os.environ.get("STREAM_PROXY_BASE"):
        from oshigo_source import OshigoSource
        OSHI_SOURCE = OshigoSource()
        await OSHI_SOURCE.start()
    if not API or len(TOKEN) < 32:
        sys.exit("CONTROL_URL dan YT_WORKER_TOKEN wajib diisi")
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    stopping = asyncio.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        asyncio.get_running_loop().add_signal_handler(sig, stopping.set)
    relay, task, backoff, next_probe, next_oauth_sync, oauth_task = None, None, 7, 0, 0, None
    async with httpx.AsyncClient(timeout=20) as client:
        ctl = Control(client)
        while not stopping.is_set():
            if oauth_task and oauth_task.done():
                try:
                    sync_status = oauth_task.result()
                    if sync_status:
                        print(json.dumps({"level": "info", "event": sync_status}), flush=True)
                except Exception:
                    print(json.dumps({"level": "warn", "event": "oauth_sync_unavailable"}), flush=True)
                oauth_task = None
            if time.time() >= next_oauth_sync and oauth_task is None:
                next_oauth_sync = time.time() + 30
                oauth_task = asyncio.create_task(sync_credentials(client, STATE, TOKEN))
            try:
                code, data = await ctl.call("poll", {"version": VERSION, "host": socket.gethostname(),
                                                     "ffmpeg": FFMPEG, "running": relay.id if relay and task and not task.done() else ""})
                if code != 200:
                    raise SafeError(f"poll_http_{code}")
                backoff = 7
                job, s, cmd = data.get("job"), data["settings"], data.get("command")
                running = task and not task.done()
                if running:
                    if not job or job["id"] != relay.id or job.get("stop_requested"):
                        relay.stop.set()
                    elif cmd and cmd["name"] == "restart" and cmd["job"] == relay.id:
                        relay.restart.set()
                elif job and not job.get("stop_requested") and job["status"] in ("starting", "checking", "live", "reconnecting"):
                    relay = Relay(job, s, ctl)
                    if relay.state.get("finished"):
                        await ctl.report(job["id"], status="failed", error="job_already_finished_manual_review")
                    else:
                        task = asyncio.create_task(relay.run())
                elif job and job.get("stop_requested"):
                    await ctl.report(job["id"], status="completed", logs=[("info", "Job dihentikan sebelum worker memulai")])
                elif not job and s["auto_enabled"] and s["in_schedule"] and time.time() >= next_probe:
                    next_probe = time.time() + 20
                    if OSHI_SOURCE:
                        if await OSHI_SOURCE.moving():
                            await ctl.call("claim", {})
                        else:
                            next_probe = time.time() + 25
                    else:
                        c2, src = await ctl.call("source", {"probe": True, "kind": "prod"})
                        if c2 == 200 and src.get("url"):
                            ALLOWED.add((urlparse(src["url"]).hostname or "").lower())
                            if await is_moving_live(client, src["url"]):
                                await ctl.call("claim", {})
                        else:
                            next_probe = time.time() + (30 if c2 == 404 else 60)
            except Exception as exc:
                print(json.dumps({"level": "warn", "error": scrub(exc)}), flush=True)
                backoff = min(backoff * 2, 120)
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(stopping.wait(), backoff)
        if oauth_task:
            oauth_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await oauth_task
        if relay and task and not task.done():
            relay.stop.set()
            with contextlib.suppress(Exception):
                await asyncio.wait_for(task, 60)
        if OSHI_SOURCE:
            await OSHI_SOURCE.close()


if __name__ == "__main__":
    asyncio.run(main())
