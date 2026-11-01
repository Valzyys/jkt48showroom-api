import { z } from 'zod';
import { showroomAvatar } from './runtime/showroom-avatar.js';

const iso = z.string().datetime();
const batch = z.object({
  room_id: z.number().int().positive().max(9999999999),
  data_id: z.string().regex(/^sr-\d+-\d+$/),
  started_at: iso,
  status: z.enum(['connecting', 'connected', 'reconnecting', 'ended']),
  dropped: z.number().int().nonnegative().default(0),
  comments: z.array(z.object({
    id: z.string().min(1).max(160),
    user: z.object({id: z.string().min(1).max(100), name: z.string().max(300), avatar_id: z.number().int().nonnegative().nullable()}),
    comment: z.string().min(1).max(4000),
    observed_at: iso,
  })).max(100),
});
const idnBatch = batch.extend({
  data_id: z.string().regex(/^idn-[a-f0-9]{24,64}$/),
  live_id: z.string().max(200).optional(),
  comments: z.array(z.object({
    id: z.string().min(1).max(160),
    user: z.object({id: z.string().min(1).max(100), name: z.string().max(300), avatar_url: z.string().max(2000).nullable()}),
    comment: z.string().min(1).max(4000), observed_at: iso, source_time: iso.optional(),
  })).max(100),
});
function commentUser(state, user) {
  if (state.platform !== 'idn') return {...user, ...showroomAvatar(user, null)};
  let avatar = null;
  try { const u = new URL(user.avatar_url); if (u.protocol === 'https:' && !u.username && !u.password && !u.port) avatar = u.href; } catch {}
  return {id: user.id, name: user.name, avatar_url: avatar};
}
const response = (data, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'private, no-store'}});
export function parseCursor(value) {
  if (value == null) return null;
  if (!/^\d{1,15}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Invalid after cursor');
  return Number(value);
}
export function commentsSnapshot(state, after = null, now = Date.now()) {
  const comments = state.comments || [], oldest = comments[0]?.sequence;
  return {
    room_id: state.room_id, data_id: state.data_id || null,
    status: state.status === 'ended' ? 'ended' : !state.updated_at || now - state.updated_at > 45000 ? 'unavailable' : state.status,
    source: state.platform === 'idn' ? 'idn-irc-websocket' : 'showroom-websocket', partial: true,
    ...(state.platform === 'idn' ? {live_id: state.live_id || null} : {}),
    updated_at: state.updated_at ? new Date(state.updated_at).toISOString() : null,
    cursor: state.sequence || 0,
    gap: after != null && (after > (state.sequence || 0) || (oldest != null && after < oldest - 1)),
    dropped: state.dropped || 0,
    comments: (after == null ? comments : comments.filter(c => c.sequence > after)).map(c => ({...c, user: commentUser(state, c.user)})),
  };
}

// One room fanout, regardless of the number of public clients. Only the
// authenticated collector entrypoint can forward a /publish request here.
export class ShowroomComments {
  constructor(ctx, platform = 'showroom') { this.ctx = ctx; this.platform = platform === 'idn' ? 'idn' : 'showroom'; }
  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const url = new URL(request.url), idn = this.platform === 'idn', room = idn ? url.searchParams.get('room_id') : Number(url.searchParams.get('room_id'));
      if (idn ? !/^idn-[a-f0-9]{24,64}$/.test(room || '') : !Number.isSafeInteger(room) || room < 1 || room > 9999999999) return response({message: 'Invalid room identifier'}, 400);
      let state = await this.ctx.storage.get('state') || {platform: this.platform, room_id: idn ? null : room, data_id: idn ? room : null, sequence: 0, comments: [], seen: []};
      if (request.method === 'POST' && url.pathname === '/publish') {
        if (Number(request.headers.get('Content-Length')) > 600000) return response({message: 'Batch too large'}, 413);
        const text = await request.text();
        if (text.length > 600000) return response({message: 'Batch too large'}, 413);
        let value;
        try { value = (idn ? idnBatch : batch).parse(JSON.parse(text)); } catch { return response({message: 'Invalid comment batch'}, 400); }
        if (idn ? value.data_id !== room : value.room_id !== room || !value.data_id.startsWith(`sr-${room}-`)) return response({message: 'Room mismatch'}, 400);
        if (Date.parse(value.started_at) < Date.parse(state.started_at || '1970-01-01T00:00:00Z')) return response({ok: true, ignored: true});
        if (state.data_id !== value.data_id) state = {platform: this.platform, room_id: value.room_id, sequence: state.sequence, comments: [], seen: []};
        // An in-flight retry must never reopen an already completed session.
        if (state.status === 'ended' && value.status !== 'ended') return response({ok: true, ignored: true});
        const seen = new Set(state.seen), added = [];
        for (const item of value.comments) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          added.push({...item, user: commentUser(state, item.user), sequence: ++state.sequence});
        }
        Object.assign(state, {room_id: value.room_id, ...(idn ? {live_id: value.live_id || null} : {}), data_id: value.data_id, started_at: value.started_at, status: value.status, updated_at: Date.now(), dropped: value.dropped});
        state.comments = [...state.comments, ...added].slice(-100);
        state.seen = [...seen].slice(-1000);
        await this.ctx.storage.put('state', state);
        await this.schedule();
        const view = commentsSnapshot(state);
        for (const ws of this.ctx.getWebSockets()) this.send(ws, {...view, type: added.length ? 'comments' : 'status', comments: added});
        return response({ok: true, accepted: added.length, cursor: state.sequence});
      }
      if (request.method !== 'GET') return response({message: 'Method not allowed'}, 405);
      let after;
      try { after = parseCursor(url.searchParams.get('after')); } catch { return response({message: 'Invalid after cursor'}, 400); }
      if (url.pathname === '/snapshot') return response(commentsSnapshot(state, after));
      if (url.pathname !== '/stream') return response({message: 'Not found'}, 404);
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return response({message: 'WebSocket upgrade required'}, 426);
      const clientId = request.headers.get('X-Comments-Client') || 'unknown', sockets = this.ctx.getWebSockets();
      if (sockets.length >= 64 || sockets.filter(s => s.deserializeAttachment()?.clientId === clientId).length >= 4) return response({message: 'Too many room connections'}, 429);
      const [client, server] = Object.values(new WebSocketPair());
      server.serializeAttachment({clientId, expires: Date.now() + 15 * 60000});
      this.ctx.acceptWebSocket(server);
      this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('PING', 'PONG'));
      this.send(server, {type: 'snapshot', ...commentsSnapshot(state, after)});
      await this.schedule();
      return new Response(null, {status: 101, webSocket: client});
    });
  }
  send(ws, value) { try { ws.send(JSON.stringify(value)); } catch { try { ws.close(1011, 'Reconnect with after cursor'); } catch {} } }
  async schedule() {
    const state = await this.ctx.storage.get('state');
    await this.ctx.storage.setAlarm(this.ctx.getWebSockets().length ? Date.now() + 30000 : (state?.updated_at || Date.now()) + 86400000);
  }
  webSocketMessage(ws, message) {
    if (message === 'PING') { try { ws.send('PONG'); } catch {} }
    else ws.close(1003, 'Send PING only; comments are read-only');
  }
  webSocketClose(ws, code) { try { ws.close(code); } catch {} }
  webSocketError(ws) { try { ws.close(1011, 'Reconnect with after cursor'); } catch {} }
  async alarm() {
    const now = Date.now(), state = await this.ctx.storage.get('state');
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment()?.expires || 0) <= now) { ws.close(1000, 'Renew API authentication; reconnect with after'); continue; }
      this.send(ws, {type: 'status', ...commentsSnapshot(state || {platform: this.platform}, null, now), comments: []});
    }
    if (state && now - state.updated_at > 86400000 && !this.ctx.getWebSockets().length) await this.ctx.storage.deleteAll();
    else if (this.ctx.getWebSockets().length || (state && now - state.updated_at < 86400000)) await this.schedule();
  }
}

export async function publicShowroomComments(request, bindings, client) {
  const url = new URL(request.url), match = /^\/api\/showroom-comments\/([1-9]\d{0,9})(\/stream)?$/.exec(url.pathname);
  if (!match) return null;
  const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'X-API-Key', 'Cache-Control': 'private, no-store'};
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
  if (!client) return response({message: 'API key required'}, 401);
  if (request.method !== 'GET') return response({message: 'Method not allowed'}, 405);
  if (!bindings.SHOWROOM_COMMENTS) return response({message: 'Comments relay unavailable'}, 503);
  const target = new URL(match[2] ? '/stream' : '/snapshot', 'https://comments.internal');
  target.searchParams.set('room_id', match[1]);
  if (url.searchParams.has('after')) target.searchParams.set('after', url.searchParams.get('after'));
  const headers = new Headers();
  if (request.headers.get('Upgrade')) headers.set('Upgrade', request.headers.get('Upgrade'));
  headers.set('X-Comments-Client', client.kind === 'key' ? client.id : client.kind);
  const stub = bindings.SHOWROOM_COMMENTS.get(bindings.SHOWROOM_COMMENTS.idFromName(match[1]));
  const result = await stub.fetch(new Request(target, {headers}));
  if (result.status === 101) return result;
  const out = new Headers(result.headers);
  for (const [key, value] of Object.entries(cors)) out.set(key, value);
  return new Response(result.body, {status: result.status, headers: out});
}

export async function publishShowroomComments(request, bindings) {
  const match = /^\/internal\/collector\/showroom-comments\/([1-9]\d{0,9})$/.exec(new URL(request.url).pathname);
  if (!match) return null;
  if (request.method !== 'POST') return response({message: 'Method not allowed'}, 405);
  if (!bindings.SHOWROOM_COMMENTS) return response({message: 'Comments relay unavailable'}, 503);
  const stub = bindings.SHOWROOM_COMMENTS.get(bindings.SHOWROOM_COMMENTS.idFromName(match[1]));
  return stub.fetch(new Request('https://comments.internal/publish?room_id=' + match[1], request));
}
