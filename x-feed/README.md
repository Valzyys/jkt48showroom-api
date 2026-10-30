# Accountless public X member archive

`jkt48-x-feed.service` runs as the separate `jkt48xfeed` system user, using
`/opt/jkt48-x-feed` and a SQLite WAL database in `/var/lib/jkt48-x-feed` (700).
It does not import Twikit, use X login cookies, read the notification bot's
account credentials, or publish to X.

The collector discovers public usernames from member metadata, falling back to
`twitter_account` in official JKT48 member detail JSON through the existing
loopback scraper. Member names are matched to current official IDs; old member
IDs are not guessed or blindly reused. Discovery runs progressively with the
same five-second request gap. It uses the private JKT48 scraper token, which is
an internal server credential, not an X account credential.

X data comes from anonymous public `https://x.com/{username}` server-rendered
JSON. JavaScript string literals are decoded with JSON parsing only; remote JS
is never executed. Quoted tweets and reposts by another author are not assigned
to a member as their original posts. Public source availability and recent-post
window size can change independently of this deployment.

The first readable profile snapshot is an archive baseline, without new-tweet
events. Subsequent unseen tweet IDs newer than the watermark create unique,
ordered update events. SQLite transactions preserve tweets/watermarks/events
across restarts. Metrics update only when posts are observed again. Loss from the
small public window is flagged when detectable; complete backfill and guaranteed
instant delivery are not claimed. The API exposes per-member successful-check
times, lookup/parse failures, next checks and possible coverage gaps.

Default interval is 300 seconds per member with a five-second gap between source
requests, one profile at a time. The full cycle can exceed that interval as
member count or latency grows. A 429 pauses the collector globally (at least five
minutes, 15 minutes by default). Login/blocked/empty/unreadable pages produce
explicit failures and preserve previously captured tweets. Metadata is refreshed
hourly, independently of individual public X timelines.

Local read API: `127.0.0.1:8796`, dedicated bearer token on every request. Nginx
serves it through a private HTTPS path; the Worker forwards requests with its
`X_FEED_TOKEN` secret and `X_FEED_URL` variable. Consumer-facing routes are under
`/api/x/` and retain the gateway API-key rules. API reads never trigger X scraping.

`/etc/jkt48-x-feed.env` is root:jkt48xfeed 640. It contains only the private relay
token, internal JKT48Connect API key, official scraper token, and interval. No X
account authorization fields are present. Memory is capped at 256 MiB and CPU at
20% of one core. The existing X posting bot remains a separate service.

Retention: 1,000 tweets per member and 50,000 immutable update-event snapshots.
An expired update cursor is indicated by `retention_gap`. Public API usage and
cursor examples are in `workers/docs/public/x-member-dan-tweet.md`.

Tests use synthetic SSR payloads, profiles and SQLite stores. Run from this
folder with `python -m unittest`. Worker relay tests live in
`workers/test/x-feed.test.js`. Production verification must read existing archive
responses, rather than force extra public X requests.
