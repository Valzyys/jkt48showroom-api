# JKT48Connect Discord on baremetal

Two independent systemd services: `jkt48-discord-notify` and
`jkt48-discord-cavallery`. Credentials are root-owned files under `/etc`, never
source files. Existing channel/role configuration is imported privately into
`/var/lib/jkt48-discord-notify/channel` and symlinked from the runtime code.
Node 24+, `npm ci --ignore-scripts`, system ffmpeg, discord.js and voice codecs
are required. The two concrete service files are generated from the included
unit template by replacing `%i` with `notify` and `cavallery` respectively.

## Two levels of control

Server admins use `/setlivechannel`, `/setnewschannel`, `/setshowchannel`,
`/setbirthdaychannel`, and `/notifikasi atur|status|matikan`. Channel and role
ownership, bot permissions, Manage Server permission and guild scope are checked.
Clearing birthday channels only clears the invoking guild. Members can use
`/help`, `/news`, `/preview`, `/undang`, `/buyapikey`, and `/donasi`.

`/notifikasi atur` opens a private interactive panel for up to ten destinations
per notification kind. A channel picker adds/opens a destination, the member menu
is paginated/searchable, and a role picker configures that channel's mentions.
Selections save immediately. Live, recent, X, TikTok and Instagram each support
independent per-channel `member_ids`: `null` (or absent on legacy rows) means all
members, `[]` means no members, and a nonempty array selects canonical member
slugs. Changing a legacy channel's mention role preserves its member filter.
New events fan out only to matching destinations; pending deliveries recheck the
current filter before sending. Existing receipts, source cursors and other guilds
are preserved. Changing a filter does not resend old events.

The public dashboard at `https://jkt48connect.app/discord` offers the same filters,
member search, per-destination test buttons and explicit Save. Tests only target
the chosen saved destination. The shared member catalogue is refreshed from the
JKT48Connect public API every ten minutes across its member/social lists; adding
channels does not multiply polling. No Instagram/TikTok/X source login is added.

Valzyy alone can use `/pengaturanbot`, `/notification` and `/blacklist` for owner
operations. The authenticated web control panel at
`https://api.jkt48connect.app/control/admin?tab=discord-bot` controls both services,
global source intervals/enabled flags, banner style/footer, guild access,
server membership, poll health, gateway statistics, journal logs and receipts.
Settings writes use the existing admin session, CSRF guard and private controller
token. No public docs expose owner API routes or credentials.

The server list distinguishes the guild owner from the installer. Installer
identity comes only from a matching Bot Add audit entry, requiring View Audit Log
and an available entry. Historical entries can be unavailable; never infer the
installer from guild ownership. Existing guild metadata is checked once, paced
at 1.5 seconds per guild, and reused from SQLite. A joining guild is checked again.
Invite permission URL requests only ordinary view/send/embed/history permissions;
audit log access is optional and must be granted by a guild admin.

## Notification delivery

Only `https://api.jkt48connect.app` is used for JKT48 data, authenticated using
`X-API-Key` from the private service environment. Live polling targets 4 seconds,
recent 6, news 45, theater 60 and birthday 900. These are target intervals;
upstream response times, network conditions and Discord rate limits add latency.
Independent loops prevent a slow source from blocking the others; API requests
have deadlines and errors back off. Bounded page sizes avoid expensive full-list
queries. The first successful check establishes a baseline, preventing migration
spam. At most the latest ten recents are observed each cycle; an outage with more
than ten completed sessions can exceed this window.

OneSignal and periodic owner DM backups are not used. The existing notification
channels and role mentions are retained; duplicate channel entries merge their
roles and produce one delivery per channel. Three concurrent sends respect the
Discord SDK's rate limiter. SQLite WAL stores each event/channel receipt, pending
attempt, message ID and actual Discord message URL. Intent is persisted before
send and a deterministic enforced nonce is used. Ambiguous sends become
`uncertain`, preventing blind retries after a crash. Removed channels and
blocked guilds do not receive new messages. Disabling a source globally holds
its pending work. First-party banners are selected only when ready; text can
be sent without waiting for media. A message sent without media is not edited
later automatically in this version.

Live/recent/theater use API-provided banner images. Birthday uses the member
photo, and news uses a supplied image when available. Point units remain IDN gold
or Showroom points and are never invented as Rupiah.

## Cavallery

REST `/api/send`, `/api/send-plain`, `/api/status`, `/api/docs` and voice commands
`/erine-join`, `/erine-leave` are preserved. REST listens only on loopback port
25613, published through HTTPS at `https://dash.jkt48connect.com/cavallery/`.
All API routes require the existing Cavallery bearer secret. Uploaded attachments
use bounded temporary storage; remote images are direct Discord embeds, not
arbitrary VPS downloads. Voice join/leave audio is imported privately from the
archive. Outbound REST messages have a persistent audit receipt in the owner UI.

## Previews and validation

`previews/notifications-media.png` uses real recent/theater metadata and images
from the public API; other examples are explicitly labeled simulations.
`previews/server-owner-settings.png` covers member, guild-admin and owner messages.
`previews/admin-desktop.png` and `admin-mobile.png` are screenshots of the deployed
admin UI. Real server names/IDs are private owner data: do not publish these
admin screenshots or configuration imports in a public repository.

Run `npm test` in this directory, `python3 -m unittest discover -s x-notifier -p
test_control.py` from the repository root and the Worker control tests before
publishing. Service journal logs redact configured secrets.

## Public website dashboard

The public site at `https://jkt48connect.app/discord` uses Discord OAuth and the
existing site design. Its OAuth setup guide lives in the website repository:
`docs/discord-auth-setup.md`. The Worker keeps client/session/bridge secrets on
the server, rechecks the user's Manage Server permission, and calls the private
`guild-api.cjs` bridge. This bridge also rechecks Discord permissions, filters
channel history, and validates channel/role ownership before updating settings.
It cannot restart services or access global owner settings.

Install `jkt48-discord-guild-api.service`, generate a dedicated 32+ character
`DISCORD_GUILD_API_TOKEN` in `/etc/jkt48-discord-guild-api.env` (600), and proxy
`/internal/discord-guild/` on the existing dash HTTPS host to 127.0.0.1:8797.
The website Worker needs the matching server-only bridge token and URL.
`guild-preferences.json` is per guild and shares the existing channel directory;
web and slash command writes use a common lock and atomic file replacement.
Global owner blocks remain effective, including dashboard test sends.

## Arcade / Activities

`/games` opens https://jkt48connect.app/games with Tebak Member, Quiz JKT48,
Memory Card, and Tebak Lagu. The website repository contains
`docs/discord-activities-setup.md` with Developer Portal setup. Activities must
be enabled manually, root URL Mapping must target jkt48connect.app, and the
Discord-created Launch entry point must remain enabled. The notifier preserves
existing type-4 entry points during slash-command synchronization.

The private guild bridge validates Activity instance participation with the bot
token using the verified OAuth user ID before the website issues a game session.
The bot token never reaches the game client. Game rooms, timers, scores and
WebSockets run in Cloudflare Durable Objects, not a new VPS polling process.

## JKT48Connect community setup

Community controls are scoped to guild `1258927086542917705`. The approved plan
in `community-plan.cjs` reuses existing rooms, preserves old room history, and
loads active oshi roles from a saved API member catalog. Runtime state is private
at `/var/lib/jkt48-discord-community/1258927086542917705/applied.json`; keep it
root-owned, group-readable by `jkt48discord` (640), with parent directories 750.
Never publish snapshots or configuration backups.

`community.cjs` handles oshi/interests/notification/DM menus, verification and
private support tickets. Verification uses an expiring code and rules agreement,
not an external CAPTCHA. Only the dedicated verification role opens community
rooms; selecting an oshi or notification role cannot grant access. Staff rooms
stay private. Tickets close without deleting history.

Run setup scripts from the deployed bot directory. Base `setup-community.cjs`
accepts `--plan` and `--apply`, but refuses to overwrite an existing access gate.
`publish-community.cjs` maintains messages using saved IDs. After migration,
`enable-community-verification.cjs` applies the gate and
`audit-community.cjs` checks effective permissions, native onboarding and role
safety. These are owner-operated migration tools, not polling jobs.

Discord Server Guide tasks must refer to public entry rooms. Bot tokens cannot
edit Server Guide (403/20001); an owner must replace old task references in the
Discord UI before previously referenced community rooms can be locked. Keep at
least three tasks and a welcome message. Verification itself stays exclusively
in the bot's dedicated channel, outside onboarding tasks. If a legacy reference
blocks permissions (350003), scripts record partial completion and the audit
reports it rather than claiming the gate is complete.

Live and recent notifications have separate channel settings. Existing guilds
without a recent destination retain the live-route fallback. Use
`/setrecentchannel` or the website Discord dashboard to set a distinct route.

Community illustrations and their onboarding/channel placement map live in
`assets/community/PLACEMENT.md`. `scripts/publish-community-art.cjs --apply`
attaches artwork to existing bot guide messages, forum guide starters and voice
text chats. It preserves message components and channel permissions, saves
receipts after each upload, and supports `--only=verify` for a single-room check.
Native Server Guide image uploads remain owner-operated in Discord settings.

## Community leveling and role display

Leveling is scoped to guild `1258927086542917705`. `leveling.cjs` listens to the
existing GuildMessages gateway events; it adds no polling and requires no
Message Content/Guild Members privileged intent. Only verified humans/staff in
configured public chat/forum channels qualify. Bots, webhooks, system messages,
entry rooms, notifications, staff logs, private tickets and command spam rooms
are excluded. Message bodies are not used or persisted.

Each eligible message earns 15–25 XP, limited to one award per 60 seconds and 100
credited messages per user per WIB day. Old/future events and duplicate message
IDs are rejected. Total XP, credited count and reward progress persist in
`$BOT_DATA_DIR/community-levels.sqlite` (SQLite WAL). Activity starts on activation;
no historical XP from other bots is invented or imported. Cumulative XP for level
L is `50 * L * (L + 1)`, with a level cap of 100.

Guild-only `/rank [member]`, `/level [member]` and `/leaderboard [halaman]` reply
privately. Level changes are announced without pings in `🏅・level-dan-rank`.
Role rewards at levels 1, 5, 10, 20, 35, 50, 75 and 100 have zero permissions and
do not unlock verification/staff channels. Only the highest earned reward is
retained. A failed reward assignment is retried on a later credited message or
when the member checks their own rank. XP is saved before Discord network calls.

`setup-community-leveling.cjs` previews the plan by default; `--apply` configures
hoisted oshi/member/team roles, reward roles, the gated level channel and its
pinned guide. State/backups remain private alongside existing community state.
The runtime installer only upserts its three guild commands; unrelated global
commands and Activities are preserved. No other guild receives XP processing.

## JKT48 voice music

The notifier now includes a guild-scoped music player for community
`1258927086542917705`. GuildVoiceStates is a standard gateway intent; no new
privileged intent or user-account access is used. Other Discord guilds and the
Cavallery bot are unchanged.

Commands: `/play lagu:<title or YouTube URL>`, `/jkt48` (continuous shuffled mode),
`/queue`, `/nowplaying`, `/pause`, `/resume`, `/skip`, `/shuffle`, `/stop`. The
now-playing card includes playback controls. A verified user must be in the
same ordinary voice channel to enqueue or control music; AFK/stage channels are
not used. Existing Connect/Speak permissions are checked before joining.

The 80-title bundled catalogue supplies autocomplete and shuffled mode. Search
accepts additional JKT48 titles/YouTube videos; it is not limited to that index.
Full public audio is resolved from YouTube when a track starts. Availability
follows the upstream source; private/age-restricted/live streams and tracks over
20 minutes are rejected. Full songs are streamed to FFmpeg and encoded as Opus,
not saved as local audio files. This does not use the short game-audio clips.

Tools live in an isolated `/opt/jkt48-discord-music-tools` Python venv. Install
`music/requirements.txt`; use Node 24 for yt-dlp's EJS solver and system FFmpeg
with libopus. Signed audio URLs and subprocess diagnostics are never published.
Only HTTPS YouTube video inputs and Googlevideo stream outputs are allowed;
subprocesses use argument arrays and ignore external yt-dlp configuration.

There is one music session for this guild. Queue limit: 25 pending tracks and
five per member. Search is cached, extraction concurrency is one, pending searches
are bounded, and audio resolution has priority. Buttons cannot control another
voice channel. Bot leaves after 30 seconds with no humans, or two minutes idle;
three consecutive source failures stop playback. Stop aborts extraction, closes
FFmpeg and disconnects. Queue/radio state is intentionally session-only; the
separate permanent XP database is unaffected by music lifecycle.

Validation includes unit checks for queue/cancellation/URL restrictions, full
source resolution, and a real Discord voice smoke test with Opus packet dispatch.
Owner-only smoke receipts are in `$BOT_DATA_DIR/music-smoke-result.json`.

## Owner's friend role

In the JKT48Connect community, `/teman tambah member:`, `/teman hapus member:`
and `/teman info` manage the **✦ Orbit** badge. Only `BOT_OWNER_ID` may
execute these commands; Discord's command visibility defaults to administrators.
The hoisted role has zero permissions, does not grant verification, and sits
above level rewards but below staff. Its ID is stored in the service-owned
`BOT_DATA_DIR/community-friends.json`. The handler refuses managed, privileged,
or uneditable roles. Role changes are recorded in Discord's audit log.

## Public X / tweet notifications

`/setxchannel channel: [role:]` enables member tweet notifications for a server.
`/setxrole member: role:` maps a member to a mention role; `/removexrole member:`
removes that mapping. `/notifikasi matikan jenis:x` disables this source for the
server, and `/preview jenis:x` previews the layout privately. Channel setup and
role mapping require Manage Server. Media can also be disabled per server from
the dashboard.

One shared poll reads `https://api.jkt48connect.app/api/x/updates` every four
seconds, rather than polling once per Discord server. The first successful
request starts at `latest_cursor` without replaying the archive. Cursor and
per-channel jobs commit together in SQLite; tweet ID plus channel deduplicates
repeated events. Restarts resume the cursor. API errors/429 use bounded backoff;
retention gaps and upstream collector health are visible in monitoring.

Tweet messages include up to four pictures, the original post link, timestamps,
and a video button. Public MP4 videos from video.twimg.com up to 8 MiB are attached
when fetched within six seconds, with a small shared in-memory cache. Larger or
unavailable videos retain their preview/link. No video file is saved on disk.

The JKT48Connect community uses its existing tweet-member channel. Each of its
58 oshi roles maps to the API member slug; only the matching oshi role is
mentioned, with explicit allowed mentions. Other guilds are opt-in and isolated.
The 4-second cadence concerns the API feed: public X collection has its own
schedule, restrictions, and coverage, and cannot guarantee instant detection
at the original publication time.

## Public TikTok notifications

`/settiktokchannel channel: [role:]` selects this server's TikTok destination.
`/settiktokrole member: role:` maps one official member slug to an oshi role;
`/removetiktokrole member:` removes it. Manage Server is required. Disable with
`/notifikasi matikan jenis:tiktok`; `/preview jenis:tiktok` is a private preview.
The public dashboard at `https://jkt48connect.app/discord` includes an independent
TikTok toggle, destination channels, role mentions, media switch and delivery
history. Older dashboard saves preserve TikTok configuration when omitted.

One shared API poll reads `/api/tiktok/updates` every four seconds for all guilds,
not once per guild. No direct TikTok request or TikTok credential is used by the
bot. The first read establishes a baseline, then cursor and per-channel receipts
commit atomically in SQLite. Restart/replay does not duplicate a post. API errors
back off, and additional pages are drained immediately. Source detection cadence
and protection delays belong to the collector; four-second feed polling cannot
promise instant original-publication detection.

Messages keep caption paragraphs, member identity, original TikTok link and real
publication time when available. Ready R2 thumbnails/galleries show up to four
images. Video up to 8 MiB downloads with a six-second bound into a two-entry
shared memory cache; larger videos keep their R2 player link. Media preparation
refreshes only database-backed API detail and allows two brief one-second waits
for a just-created cover. It never waits indefinitely for rendering/upload.
Per-server media opt-out is respected. Only explicit destination/member roles
are mentioned; source captions cannot ping @everyone or arbitrary roles.

The owner console exposes TikTok polling, errors, cursor, log terminal, delivery
history and global source enable/disable. TikTok and X API cadence are fixed at
four seconds. Public guild admins cannot change global controls.

`scripts/setup-community-tiktok.cjs` adds the owner's destination idempotently,
cloning permissions from the existing tweet channel. It verifies that the
verification gate remains closed to @everyone and copies the owner's 58 slug
mappings into a separate TikTok map. Other guilds remain opt-in. Setup publishes
one guide in that channel, without role pings. It does not replay archived posts.

## Public Instagram notifications

`/setinstagramchannel channel: [role:]` selects this server's destination.
`/setinstagramrole member: role:` and `/removeinstagramrole member:` manage
independent per-member oshi mentions, with Manage Server required. Pause using
`/notifikasi matikan jenis:instagram`; `/preview jenis:instagram` is private.
The public website dashboard includes the independent Instagram destination,
enable switch, role mentions, media preference and delivery history. Older
dashboard clients preserve this configuration when the new field is omitted.

One shared `/api/instagram/updates` cursor is polled every four seconds for all
servers. The bot never scrapes or logs in to Instagram. API source detection
still follows the anonymous collector's schedule/backoff, not the bot's polling
interval. First activation establishes a baseline; archived posts are not replayed.
Cursor and deduplicated per-channel jobs commit together in SQLite and survive
restart. Errors back off and additional event pages drain without a long delay.

Messages show the real caption paragraphs, member, timestamp when available,
original post/Reel link, up to four ready R2 images and the available video link.
Reels and carousel videos are uploaded as MP4 attachments. The notification text
is sent first; media readiness is checked in a durable job that edits that same
message without another role ping. A ready cover never marks a missing video as
finished. Up to ten files share a 20 MiB preparation budget; individual uploads
target at most 9 MiB. Videos larger than their allowance are compressed with
FFmpeg while retaining their duration and audio. Downloads accept at most 64 MiB
per video with a 45-second deadline. Pending media retries back off and expire
after 24 hours. Unsupported files retain their R2/original post link. Media
opt-out is respected. Only explicitly configured roles may be mentioned.

Owner controls expose global enable/disable, polling health, cursor, errors,
logs and history. `setup-community-instagram.cjs` idempotently adds the owner's
Instagram channel with the existing verification permissions and separate oshi
mapping. Other guilds remain opt-in. `preview-community-instagram.cjs` sends one
explicitly labelled archive example without role pings, using actual API media.
