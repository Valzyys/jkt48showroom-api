# Social notification media delivery

X, TikTok and Instagram notifications send their text and links immediately. A separate worker enriches the **same Discord message** with actual files; it never sends a second notification or mentions roles again.

- Media edits are stored in `social_media_deliveries` inside the existing notification SQLite database. Original delivery receipts and source cursors are unchanged.
- TikTok/Instagram metadata is refreshed from the JKT48Connect archive API only. Pending R2 videos remain eligible even if a thumbnail is already ready.
- Multiple X videos/GIFs and mixed Instagram carousels are supported. Files are validated by host, post ID, content type and signature.
- File preparation is shared across guilds. Prepared results and downloads use bounded memory caches. The worker processes at most two message edits concurrently.
- Source downloads are capped at 64 MiB per video and 8 MiB per image. A single message uses at most ten attachments and 20 MiB of newly uploaded data. Video gets priority over thumbnails.
- Videos exceeding the per-file budget are compressed to H.264/AAC using one CPU thread with lower process priority. No duration cut is applied. Temporary files are deleted in `finally`, including on conversion failure. Supported clips that cannot fit retain their source link.
- Discord requires View Channel, Send Messages, Embed Links, Attach Files and Read Message History. Disabled media and removed routes are respected. `/undang` requests the needed file permission for new installations.
- Edits fetch the current message from Discord and retain existing attachment IDs. A lost edit response can safely be retried without duplicating attachments. Only messages authored by this bot are edited.
- Pending metadata/download errors retry after 5s, 10s, 20s and so on, capped at five minutes, for at most 24 hours. Missing permissions retry every five minutes. Permanent invalid/oversize media is recorded as partial rather than retried forever.
- On startup, a bounded selection of video notifications from the last six hours can be repaired. No historical notifications are reposted.

Watch `notification-media-attached`, `notification-media-wait`, and `social_media` counts in the bot state. Polling and notification delivery continue while media is prepared.
