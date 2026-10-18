"""Move theater JPEGs to R2 and reclaim confirmed YouTube uploads without stopping capture."""
import asyncio, contextlib, json, logging, os, re, sqlite3
from pathlib import Path
from curl_cffi.requests import AsyncSession

log = logging.getLogger('theater-storage')
confirmed_thumbnails = set()

def cleanup_video(folder, row):
    # A real upload ID and confirmed privacy are required, including after a crash.
    if row.get('status') != 'uploaded' or not re.fullmatch(r'[A-Za-z0-9_-]{11}', row.get('youtube_id') or '') or row.get('youtube_privacy') != 'unlisted':
        return 0
    reclaimed = 0
    for path in [*folder.glob('run-*/*.ts'), folder/'recording.mp4', folder/'finalizing.mp4', folder/'concat.txt']:
        try:
            size = path.stat().st_size
            path.unlink()
            reclaimed += size
        except FileNotFoundError:
            pass
    for directory in folder.glob('run-*'):
        with contextlib.suppress(OSError):
            directory.rmdir()
    return reclaimed

async def archive_screenshots(client, root, row, base, token):
    if not re.fullmatch(r'[a-f0-9]{32}', row.get('id', '')):
        return 0
    folder = root/row['id']
    count = 0
    for frame in row.get('screenshots', []):
        if not re.fullmatch(r'\d{13}', str(frame)):
            continue
        path = folder/(str(frame)+'.jpg')
        if not path.is_file():
            continue
        marker = (row['id'], frame)
        if marker in confirmed_thumbnails:
            if row.get('thumbnail_status') != 'pending':
                path.unlink(missing_ok=True)
                confirmed_thumbnails.discard(marker)
                count += 1
            continue
        content = path.read_bytes()
        if not 4 <= len(content) <= 2000000 or content[:3] != b'\xff\xd8\xff':
            continue
        try:
            response = await client.put(base+'/internal/collector/theater/screenshot/'+row['id']+'/'+path.name,
                headers={'Authorization':'Bearer '+token,'Content-Type':'image/jpeg'},data=content,timeout=30,allow_redirects=False)
            result = response.json() if response.status_code == 200 else {}
            if result.get('ok') is not True or result.get('storage') != 'r2' or result.get('bytes') != len(content):
                continue
            # The running recorder still needs the first JPEG for the YouTube thumbnail.
            # Keep only that tiny staging file until its thumbnail request completes.
            if frame == row.get('screenshots', [None])[0] and row.get('thumbnail_status') == 'pending':
                confirmed_thumbnails.add(marker)
                continue
            path.unlink(missing_ok=True)
            count += 1
        except Exception:
            log.warning('screenshot-transfer-retry')
    return count

async def maintain(client, root, base, token):
    with sqlite3.connect('file:'+str(root/'state.sqlite')+'?mode=ro', uri=True, timeout=10) as db:
        rows = [json.loads(value) for value, in db.execute('SELECT value FROM sessions')]
    for row in rows:
        if not re.fullmatch(r'[a-f0-9]{32}', row.get('id', '')):
            continue
        try:
            reclaimed = cleanup_video(root/row['id'], row)
            moved = await archive_screenshots(client, root, row, base, token)
            if reclaimed or moved:
                log.info('media-cleaned video_bytes=%d screenshots=%d', reclaimed, moved)
        except Exception:
            log.warning('media-maintenance-retry')

async def main():
    root = Path(os.environ.get('THEATER_STATE_DIR','/var/lib/jkt48-theater-recorder'))
    base = os.environ.get('THEATER_API_TRANSPORT_URL','https://api.jkt48connect.app:8443').rstrip('/')
    async with AsyncSession(impersonate='chrome') as client:
        while True:
            try:
                await maintain(client, root, base, os.environ['COLLECTOR_TOKEN'])
            except Exception:
                log.warning('storage-pass-retry')
            await asyncio.sleep(5)

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s')
    asyncio.run(main())
