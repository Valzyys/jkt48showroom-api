# YouTube Auto Live — private OAuth reconnect

Admin page: https://api.jkt48connect.app/control/youtube-oauth

Register `https://api.jkt48connect.app/control/youtube-oauth/callback` as an authorized redirect URI on the Google OAuth **Web application** client. Enable YouTube Data API v3. Use the same Google account/channel as the live worker. If the OAuth app is in Testing, add the account as a test user; publish the consent app when eligible to avoid Testing refresh-token expiry.

## API

- `POST /control/api/youtube-oauth/start`: existing admin session, same-origin `Origin`, `X-Requested-With: jkt48connect` and session `X-CSRF-Token`. Returns `authorization_url` and a short-lived HttpOnly OAuth cookie. Open the URL in that same browser.
- `GET /control/youtube-oauth/callback`: Google redirect; validates a one-use state, the browser cookie and PKCE. Exchanges the code and stores credentials encrypted using a key derived from `AUTH_SECRET`. Never returns tokens to the browser.
- `GET /control/api/youtube-oauth/status`: admin-only; channel, connected state and last VPS acknowledgement. No credential values.
- `/internal/youtube-oauth/credentials` (GET) and `/internal/youtube-oauth/ack` (POST): worker-only bearer authentication. These routes must never be called from frontend code, public API keys or published public docs.

Cloudflare secrets: `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET`, `YOUTUBE_OAUTH_WORKER_TOKEN`. The last value matches the VPS `YT_WORKER_TOKEN`; all remain private. Database migration: `workers/migrations/0020_youtube_oauth.sql`.

## VPS

`credential_sync.py` runs in the existing persistent worker, checking at most once per 30 seconds without blocking the stream-control loop. A new credential version is saved atomically as `/var/lib/jkt48-youtube-live/oauth-token.json`, mode 600. Acknowledge after saving. YouTube token refresh uses this saved credential, falling back to the original environment when no saved credential exists. No env rewrite or stream restart is needed for subsequent reconnects.

Files: `/opt/yt-live/youtube_auto_live.py`, `/opt/yt-live/credential_sync.py`, `/opt/yt-live/oshigo_source.py`. Existing ffmpeg/HLS settings and systemd hardening are retained. Do not commit env, cookies, token state or backup credentials.

Reauthorization requires Google account consent. A revoked refresh token cannot be renewed silently using another refresh call. Channel live-stream eligibility and YouTube quotas still apply.

Tests: `node --test workers/test/youtube-oauth.test.js` after installing Worker dependencies; build before `workers/test/integration/youtube-oauth.test.js`. VPS helper: `python -m unittest test_credential_sync.py` from this folder with httpx installed.
