# JKT48 public TikTok archive

The production collector runs independently on the baremetal as
`jkt48-tiktok-feed.service`. It uses public creator/post embed pages, without
TikTok Display API credentials, user login, imported account cookies, or paid
proxies. The existing relay, live collectors, recorder and bots remain separate.

## Storage and API

SQLite metadata, posts, update events and scheduling state live permanently in
`/var/lib/jkt48-tiktok-feed/archive.sqlite` (WAL). Baseline/posts/watermark/update
insertion is transactional. Old pinned IDs, reordered responses and restarts do
not create duplicate events. Source failures retain previous successful data.
No historical paging or automatic deletion is performed. Back up the database
with SQLite's backup API, rather than copying a live WAL database file alone.

`service.py` exposes a bearer-protected read-only relay on `127.0.0.1:8798`.
`nginx.conf` adds a separate location to the existing HTTPS host. The public
Worker exposes `/api/tiktok/{status,members,posts,updates,search}` plus post detail
and per-member post routes. API requests read the archive and never scrape
TikTok. Public consumer documentation is in
`workers/docs/public/tiktok-member-dan-post.md`.

Media uploads use a separate authenticated Worker operation, a fixed R2 prefix,
strict member/post/asset paths, MIME signatures and size bounds. Public results
contain R2 URLs on the API domain, never temporary TikTok CDN URLs. One media
job runs at a time; image limit 8 MiB and video limit 64 MiB. Larger media has an
explicit unsupported status. No complete media file is stored on the VPS disk.
Byte ranges, HEAD, ETag and CORS support browser playback. Pending media remains
pending until R2 acknowledges the upload; failures back off and can be retried.

## Scheduling and limits

The source gate serializes profile/detail requests with a 15–25 second random
gap. Each profile is scheduled 10–15 minutes after success; total source windows,
number of accounts, detail enrichment and protection responses can make the
actual revisit interval longer. All 48 discovered handles are collected serially,
not in 48 simultaneous browsers. Creator requests have priority at the gate
through their shorter scheduling loop; detail reads share the same budget.

`browser.cjs` is a bounded fallback, at most once per five minutes. It reuses
installed Chromium/puppeteer binaries read-only, launches its own anonymous
browser and closes it on completion. It does not solve challenges or import
account cookies. Source blocks trigger global cooldown and per-profile backoff.
The systemd service has a separate user/state directory, 768 MiB memory limit,
30% CPU quota, read-only system/home and no new privileges.

Official JKT48 member metadata is refreshed daily. Handles are validated, never
guessed. Member directory errors are separate from TikTok source health. A
heartbeat means the process is alive; `last_success_at`/per-member errors show
whether the source actually works. The source is a limited embed window, not a
complete historical API. Private accounts/DMs are excluded. Photo gallery schema
has offline tests, but the original six live samples did not include a carousel.
Missing fields remain null. Abbreviated view counts are not expanded into guessed
exact totals. Source duration is `reported_duration_seconds`, separate from any
actual measured file duration.

## Configuration

Private `/etc/jkt48-tiktok-feed.env`, root-owned mode 600:

- `TIKTOK_FEED_TOKEN`: unique private relay/upload bearer, also a Worker secret.
- `JKT48CONNECT_API_KEY`: existing JKT48Connect key, only for directory lookup.
- `SCRAPER_TOKEN`: private local official-member lookup bearer.
- Optional `TIKTOK_PORT` (8798) and `TIKTOK_DATABASE`.

Worker var: `TIKTOK_FEED_URL`. Secrets are never placed in public docs or logs.
No TikTok source credentials are required. Do not rotate unrelated service keys.

## Verification and research

```sh
python3 -m unittest discover -s tiktok-feed -v
cd workers && node --test test/tiktok-feed.test.js
```

The unit suite covers identity/privacy/host checks, persistent baselines, duplicate
and old-pin handling, enrichment, filters, pagination, cursors, media states,
concurrent reads and authentication. Worker checks cover bounded private relay,
R2 upload validation/idempotency and actual byte-range response content.

`probe.py` and `browser_probe.cjs` are bounded, isolated research tools. The
research archive established 65 distinct posts across six official accounts;
58 active member records yielded 48 official TikTok handles and 10 unpublished
handles. All six video samples had readable audio/video frames. One complete
4.93 MB sample decoded through 883 frames. HTTP-only soak was not fully reliable;
browser fallback improved coverage but cannot guarantee continuous access.
Detailed local reports live under `../output/tiktok-research/`, outside git.

A research seed is a baseline, never a burst of old update events. Seed via the
SQLite backup API, then initialize `Archive`, import the verified directory and
parse verified post-detail HTML. Raw HTML, signed URLs and private database files
must stay out of git.

Public field-layout reference (independent implementation here):
https://github.com/sendyarf/jkt48-archiver/blob/main/bot/tiktok_client.py

## Profile freshness

Account-specific parser/private/profile errors no longer pause every creator. HTTP 403/429/503 retain bounded global backoff and the existing 15–25 second serialized source gap. Due profiles take priority; one detail request is allowed after four profile attempts, and pending details prefer the newest post IDs. Old detail failures do not impose a global pause. Existing cursors, baseline and permanent posts survive restart. Actual check cadence still depends on the roster and source availability.
