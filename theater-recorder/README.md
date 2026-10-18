# Theater capture → YouTube

Independent service: does not change the existing IDN/Showroom R2 collector.
The discovery feed is the authorized `THEATER_DISCOVERY_URL` supplied by the
operator. Only explicit live statuses start recordings. The HLS resolver always
receives `slug=itadakilove-2026-05-14-260510220015`, as required by this gateway;
its current HLS stream belongs to the currently live schedule. The fixed slug
must not be replaced with each discovered show's slug.

Video uploads are always **unlisted**. OAuth client ID, client secret, refresh
token and discovery URL live only in root-owned `/etc/jkt48-theater-recorder.env`
(mode 600); the service also reads `/etc/jkt48-live-collector.env` for its private
Worker token. None of these values belongs in the repository or public docs.

Copy `recorder.py` and `media_storage.py` to `/opt/jkt48-theater-recorder/`, install the systemd unit,
and use the existing collector Python environment (`curl_cffi` required).
`ffmpeg` and `ffprobe` must be installed. The service listens for authenticated
screenshot GET/HEAD requests on **127.0.0.1:8790** only. On the existing scraper
Nginx virtual host, proxy `/theater-captures/` to that listener, preserving the
Authorization header. Worker authenticates fallback requests and archives JPEGs in R2.
The independent `jkt48-theater-storage.service` uploads existing and new screenshots
to the authenticated Worker endpoint, which writes the existing IMAGES_BUCKET.
Public URLs stay stable and read from R2. Install and enable the storage unit too;
it does not require restarting an active recorder.

## Persistence and boundaries

Recordings spool as MPEG-TS segments in `/var/lib/jkt48-theater-recorder`.
SQLite tracks discovery, reconnects, screenshots and resumable Google session
URIs. Recordings survive service restarts; an interrupted capture is marked
partial. Four successful discovery polls with the show absent confirm an end;
discovery/network failures never terminate a live capture. FFmpeg reconnects
and creates another run after a disconnect. A late start or reconnect is
explicitly reported as partial; past, unavailable live footage cannot be
recovered by starting the service later.

After recording ends, segments merge to MP4 and upload sequentially. Each
retry asks Google for its acknowledged offset, avoiding a second videos.insert
for an existing resumable session. Completed video IDs and URLs are persisted
before local video files are removed. Quota errors wait an hour; other upload
errors wait five minutes. Upload failures retain the original local media.
The storage service checks every five seconds and retries failed transfers.
JPEGs are deleted locally only after R2 acknowledges the stored byte count.
Only the first JPEG is staged until the YouTube thumbnail request finishes.
Confirmed unlisted videos have MP4, TS, concat and finalization files deleted;
the storage service also recovers cleanup interrupted by a crash.
One screenshot is uploaded as the YouTube thumbnail; JPEGs are stored in R2. Custom thumbnails require channel permission; thumbnail failure does
not discard the successful video upload.

Default limits: 2 simultaneous theater sessions, 20-second discovery,
60-second screenshots, at most 3000 screenshots per session, 10 GiB minimum
free space for recording. Finalization also requires space for a complete MP4.
These are bounded resource controls, not guarantees against provider or network
interruptions. The admin Theater YouTube tab exposes health, errors, free
space, pending uploads, captures and actual YouTube URLs.

Public consumers: `/api/theater/recordings` and `recordings` in matching theater
details. Existing API-key rules apply. Pending uploads have `youtube_url: null`;
only a real Google video ID creates a URL. YouTube can take additional time to
process a successfully uploaded video.
