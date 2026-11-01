const base = 'https://image.showroom-cdn.com/showroom-prod/image/avatar/';
function positiveId(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (!/^\d{1,15}$/.test(String(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
// Showroom's avatar is the on-stage character, distinct from a profile photo.
// Resolve locally: no per-user profile fetches or extra latency on recent reads.
export function showroomAvatar(user = {}, fallback = 1) {
  let id = positiveId(user.avatar_id);
  if (!id && typeof user.avatar_url === 'string') {
    try {
      const url = new URL(user.avatar_url);
      const match = url.protocol === 'https:' && !url.username && !url.password && !url.port && (
        url.hostname === 'image.showroom-cdn.com' ? /^\/showroom-prod\/image\/avatar\/(\d+)\.png$/ :
        url.hostname === 'static.showroom-live.com' ? /^\/image\/avatar\/(\d+)\.png$/ : /$a/
      ).exec(url.pathname);
      id = match ? positiveId(match[1]) : null;
    } catch {}
  }
  id ||= positiveId(fallback);
  return {avatar_id: id, avatar_url: id ? base + id + '.png' : null};
}
