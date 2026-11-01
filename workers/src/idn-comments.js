import { ShowroomComments } from './showroom-comments.js';

export class IdnComments extends ShowroomComments {
  constructor(ctx) { super(ctx, 'idn'); }
}
const reply = (data, status) => Response.json(data, {status, headers: {'Cache-Control': 'private, no-store'}});
export async function publicIdnComments(request, bindings, client) {
  const url = new URL(request.url), match = /^\/api\/idn-comments\/(idn-[a-f0-9]{24,64})(\/stream)?$/.exec(url.pathname);
  if (!match) return null;
  const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'X-API-Key', 'Cache-Control': 'private, no-store'};
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
  if (!client) return reply({message: 'API key required'}, 401);
  if (request.method !== 'GET') return reply({message: 'Method not allowed'}, 405);
  if (!bindings.IDN_COMMENTS) return reply({message: 'Comments relay unavailable'}, 503);
  const target = new URL(match[2] ? '/stream' : '/snapshot', 'https://comments.internal');
  target.searchParams.set('room_id', match[1]);
  if (url.searchParams.has('after')) target.searchParams.set('after', url.searchParams.get('after'));
  const headers = new Headers({'X-Comments-Client': client.kind === 'key' ? client.id : client.kind});
  if (request.headers.get('Upgrade')) headers.set('Upgrade', request.headers.get('Upgrade'));
  const stub = bindings.IDN_COMMENTS.get(bindings.IDN_COMMENTS.idFromName(match[1]));
  const result = await stub.fetch(new Request(target, {headers}));
  if (result.status === 101) return result;
  const out = new Headers(result.headers);
  for (const [key, value] of Object.entries(cors)) out.set(key, value);
  return new Response(result.body, {status: result.status, headers: out});
}
export async function publishIdnComments(request, bindings) {
  const match = /^\/internal\/collector\/idn-comments\/(idn-[a-f0-9]{24,64})$/.exec(new URL(request.url).pathname);
  if (!match) return null;
  if (request.method !== 'POST') return reply({message: 'Method not allowed'}, 405);
  if (!bindings.IDN_COMMENTS) return reply({message: 'Comments relay unavailable'}, 503);
  const stub = bindings.IDN_COMMENTS.get(bindings.IDN_COMMENTS.idFromName(match[1]));
  return stub.fetch(new Request('https://comments.internal/publish?room_id=' + match[1], request));
}
