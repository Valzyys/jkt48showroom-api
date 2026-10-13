const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MEDIA_HEADERS = ['accept', 'range', 'if-range', 'if-none-match', 'if-modified-since'];

export class UpstreamError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export function checkedURL(value, allowedHosts, allowHttp = false) {
  let url;
  try { url = new URL(value); } catch { throw new UpstreamError('Invalid upstream URL', 400); }
  if (url.username || url.password || (!allowHttp && url.protocol !== 'https:') || (allowHttp && !['http:', 'https:'].includes(url.protocol))) {
    throw new UpstreamError('Invalid upstream URL', 400);
  }
  if (url.port && url.port !== '443' && !(allowHttp && url.port === '80')) throw new UpstreamError('Invalid upstream port', 400);
  if (allowedHosts && !allowedHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new UpstreamError('Upstream host is not allowed', 400);
  }
  return url;
}

export function showroomTarget(value, config) {
  let url = new URL(value);
  if (url.hostname === 'www.showroom-live.com' && config.SHOWROOM_API) {
    const base = checkedURL(config.SHOWROOM_API, null);
    url = new URL(base.href.replace(/\/$/, '') + url.pathname + url.search);
  }
  const showroomBase = config.SHOWROOM_API ? new URL(config.SHOWROOM_API) : null;
  if (config.PROXY_URL && (url.hostname === 'www.showroom-live.com' || url.origin === showroomBase?.origin)) {
    checkedURL(config.PROXY_URL, null);
    return config.PROXY_URL + url.href;
  }
  return url.href;
}

export async function timedFetch(input, init = {}, fetcher = fetch, timeout = 15000) {
  const controller = new AbortController();
  const originalSignal = init.signal ?? (input instanceof Request ? input.signal : undefined);
  const abort = () => controller.abort(originalSignal.reason);
  if (originalSignal?.aborted) abort();
  else originalSignal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Upstream timeout')), timeout);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (originalSignal?.aborted) throw error;
    throw new UpstreamError(controller.signal.aborted ? 'Upstream timeout' : 'Upstream unavailable', controller.signal.aborted ? 504 : 502);
  } finally {
    clearTimeout(timer);
    originalSignal?.removeEventListener('abort', abort);
  }
}

export function rewritePlaylist(text, upstream, requestURL) {
  const encode = value => {
    const target = new URL(value, upstream);
    if (target.protocol !== 'https:') throw new UpstreamError('Invalid media URL', 502);
    const proxy = new URL('/api/stream', requestURL);
    proxy.searchParams.set('url', target.href);
    return proxy.href;
  };
  return text.split(/\r?\n/).map(line => {
    if (!line.trim()) return line;
    if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, value) => `URI="${encode(value)}"`);
    return encode(line.trim());
  }).join('\n');
}

export async function streamProxy(request, config = {}, fetcher = fetch) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  const hosts = String(config.STREAM_ALLOWED_HOSTS || 'playback.live-video.net,live.showroom-live.com').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  const rawURL = new URL(request.url).searchParams.get('url');
  if (!rawURL) throw new UpstreamError('Missing url', 400);
  let url = checkedURL(rawURL, hosts);
  const headers = new Headers();
  for (const name of MEDIA_HEADERS) if (request.headers.has(name)) headers.set(name, request.headers.get(name));
  let response;
  for (let redirects = 0; ; redirects++) {
    response = await timedFetch(url.href, { method: request.method, headers, redirect: 'manual', signal: request.signal }, fetcher, Number(config.UPSTREAM_TIMEOUT_MS || 15000));
    if (!REDIRECTS.has(response.status)) break;
    const location = response.headers.get('location');
    if (!location || redirects >= 4) { await response.body?.cancel(); throw new UpstreamError('Invalid upstream redirect'); }
    await response.body?.cancel();
    url = checkedURL(new URL(location, url).href, hosts);
  }
  const output = new Headers();
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'retry-after']) {
    if (response.headers.has(name)) output.set(name, response.headers.get(name));
  }
  output.set('Cache-Control', 'no-store');
  output.set('X-Content-Type-Options', 'nosniff');
  if (request.method === 'HEAD' || [204, 304].includes(response.status)) return new Response(null, { status: response.status, headers: output });
  const playlist = /mpegurl/i.test(output.get('content-type') || '') || /\.m3u8$/i.test(url.pathname);
  if (response.ok && playlist && response.status !== 206) {
    const text = await response.text();
    if (!text.trimStart().startsWith('#EXTM3U')) throw new UpstreamError('Invalid upstream playlist');
    if (text.length > 2 * 1024 * 1024) throw new UpstreamError('Playlist is too large');
    output.delete('content-length');
    output.delete('etag');
    output.set('content-type', 'application/vnd.apple.mpegurl');
    return new Response(rewritePlaylist(text, url.href, request.url), { status: response.status, headers: output });
  }
  return new Response(response.body, { status: response.status, headers: output });
}
