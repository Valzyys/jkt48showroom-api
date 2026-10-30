# Anonymous Instagram collector

Collects member-owned posts from Instagram's public, logged-out HTML. Anonymous access remains the default. An optional owner-provided cookie session can be used only after public profile routes fail. No Graph API, automatic login, or challenge solving is used. Member handles come from JKT48's official member metadata. Public API readers only query the local SQLite archive; they never initiate source requests.

## Runtime

- Code: `/opt/jkt48-instagram-feed`; dedicated `jkt48instagram` user and virtualenv.
- State: `/var/lib/jkt48-instagram-feed/archive.sqlite` (SQLite WAL, permanent posts/events, no automatic pruning).
- Service: `jkt48-instagram-feed.service`, loopback port `8799` only.
- Private env: `/etc/jkt48-instagram-feed.env`, root-owned mode `600`.
- Required env names: `INSTAGRAM_FEED_TOKEN` (random relay/upload secret, at least 32 characters), `JKT48CONNECT_API_KEY` (existing API credential), `SCRAPER_TOKEN` (existing local official-site scraper credential). Never commit their values.
- Optional: `INSTAGRAM_DATABASE`, `INSTAGRAM_PORT`.
- Nginx: include `nginx.conf` in the existing dashboard HTTPS server. The private relay still requires bearer authentication. It exposes no write routes.
- Worker vars: `INSTAGRAM_FEED_URL=https://dash.jkt48connect.com/internal/instagram-feed`; matching `INSTAGRAM_FEED_TOKEN` as a Worker secret. Media uses the existing `IMAGES_BUCKET` binding under a separate `instagram/` prefix.

Install the pinned requirements into the isolated virtualenv, install the unit, test Nginx configuration before reloading, deploy the Worker routes/media handler, then enable/start this service. Do not restart other collectors. Logs are available through `journalctl -u jkt48-instagram-feed`; request headers, bearer tokens, raw HTML, and signed media URLs are not logged.

## Collection and storage

Profile and post-detail requests share one serialized source gate, with a persisted 20–35 second random gap. Each account is eligible again after 15–20 minutes; actual refresh time depends on all accounts, detail work, and source backoff. Account-specific login walls and parser errors back off only that account. Global pauses apply to HTTP 403/429/503, with the persisted source gap still enforced. A backlog of old post details cannot halt profile discovery: due profiles take priority, with one detail slot after four profile attempts. Private accounts are skipped for 24 hours. Successful post details become eligible for metadata refresh after six hours.

The first successful profile read establishes a baseline. Later unseen IDs above its watermark generate durable update cursors in the same transaction as the archive write. Old pinned posts, reordering, repeated reads, and service restarts do not produce duplicate new-post events. Source failures retain previously archived data. A public profile exposes a limited window, not a complete history; no automatic history pagination is performed. Collaborations owned by another author are excluded.

If an embed attributes a collaboration to a profile while its post ID already belongs to another archived member, the archive preserves that owner and excludes only that shared post. The remaining profile posts still update normally; shared posts never generate a second notification under another member.

Public profile embeds provide a fallback when the standard logged-out profile redirects to login. Their context JSON is decoded without evaluating scripts, and post owner IDs/usernames must match. An unavailable embed never becomes an empty successful profile. Full details enrich actual publication timestamps, metrics, carousel order and video URLs. Missing/hidden values remain null. Public JSON rewrites all nested media to R2 asset descriptors, never raw signed Instagram CDN URLs. A single bounded media job streams bytes into memory, validates the signature, then uploads to the private Worker handler. It does not write media files to disk. Covers, gallery items and videos receive rotating priority; persistent asset retries survive restart. Limits: 8 MiB per image, 64 MiB per video; oversized files are explicitly unsupported.

An incomplete profile/detail refresh preserves an already known video source for the same carousel item ID. Public video descriptors also remain available from uploaded R2 assets when the original source URL is absent; known video slots without uploaded media remain `pending` instead of disappearing as `null`.

R2 URLs use `https://api.jkt48connect.app/media/instagram/<member>/<numeric-post-id>/<asset>` and support public GET/HEAD, CORS, ETag and single byte ranges for playback. Metadata is permanent locally; R2 objects have immutable paths. Back up the SQLite database with its online backup API and the private env through the existing server backup policy.

## API and validation

See the public guide in `workers/docs/public/instagram-member-dan-post.md` for eight routes, filters, cursor consumption and limits. The API uses the same consumer API-key mechanism as other JKT48Connect endpoints. Instagram itself does not require an account for this collector.

```sh
cd instagram-feed
python3 -m unittest -v test_feed.py
```

The tests cover page identity, source gating, hidden metrics, author checks, ordered mixed galleries, durable baselines/cursors, enrichment preservation, CDN URL removal, input validation, concurrent archive reads and private relay authentication. Worker tests separately verify fixed relay paths and R2 upload validation, idempotency, ETags and actual byte ranges.

This service cannot promise every post or immediate detection: Instagram may change its HTML or restrict anonymous visitors. Inspect per-member success/error timestamps and `coverage_gap_possible`; `collector_online` alone only confirms the process heartbeat.

## Optional private session fallback

Set `INSTAGRAM_COOKIE_FILE` in the existing private service environment to a Netscape cookie export outside the repository. Production uses `/etc/jkt48-instagram/cookies.txt`, directory mode 700 and file mode 600, owned by `jkt48instagram`. Cookie values are never logged, returned by the API, or included in archive/R2 uploads. The file is read only; server cookie updates stay in memory. Replacing the file reloads the session without a restart.

Only secure, unexpired Instagram cookies with root path are accepted. Session requests are restricted to HTTPS on `www.instagram.com`, profile pages and the fixed web-profile endpoint, with redirects disabled. Private profiles remain excluded from the public archive even if the supplied account could access them. Anonymous routes remain first and the existing serialized request gap still applies. Session-only rate limits pause the session, leaving anonymous collection available. Expired/login-required/checkpoint sessions stop until the cookie file changes; human verification is never automated.

`/api/instagram/status` exposes only safe session state and retry timestamps. `login_used` indicates whether an authenticated read has succeeded; cookie presence alone is not treated as a successful login.
