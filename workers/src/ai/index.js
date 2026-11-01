import { MODELS } from './profile.js';
import { normalize, fail } from './protocol.js';
import { openUpstream } from './upstream.js';
import { generate, errorBody } from './output.js';

const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no' };
const digest = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
const limit = (v, fallback, max) => /^\d+$/.test(String(v)) && Number(v) > 0 ? Math.min(max, Number(v)) : fallback;
async function authorized(request, bindings) {
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') || '')?.[1];
  const token = bearer || request.headers.get('X-API-Key');
  if (!bindings.PIP_API_KEY || bindings.PIP_API_KEY.length < 32) throw fail('Pip API is not configured.', 503, 'service_unavailable');
  if (!token || token.length > 256 || await digest(token) !== await digest(bindings.PIP_API_KEY)) throw fail('A valid Pip API key is required. Data API keys and website sessions do not grant AI access.', 401, 'invalid_api_key');
  return digest(token);
}
async function bodyJSON(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw fail('Use Content-Type: application/json.', 415);
  const max = 1024 * 1024;
  if (Number(request.headers.get('content-length')) > max) throw fail('Request exceeds 1 MiB. Compact the conversation.', 413, 'context_length_exceeded');
  if (!request.body) throw fail('JSON body is required.');
  const reader = request.body.getReader(), chunks = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > max) { await reader.cancel(); throw fail('Request exceeds 1 MiB. Compact the conversation.', 413, 'context_length_exceeded'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw fail('Invalid JSON body.'); }
}
export async function reserve(bindings, hash, now = Date.now()) {
  if (!bindings.DB) throw fail('AI usage accounting is unavailable.', 503, 'service_unavailable');
  const day = new Date(now).toISOString().slice(0, 10), window = Math.floor(now / 60000);
  const perMinute = limit(bindings.PIP_REQUESTS_PER_MINUTE, 20, 120), daily = limit(bindings.PIP_REQUESTS_PER_DAY, 500, 10000);
  const row = await bindings.DB.prepare(`INSERT INTO pip_ai_usage(key_hash,day,requests,window,window_requests) VALUES(?1,?2,1,?3,1)
    ON CONFLICT(key_hash,day) DO UPDATE SET requests=requests+1,window=?3,
    window_requests=CASE WHEN window=?3 THEN window_requests+1 ELSE 1 END
    WHERE requests < ?4 AND (window != ?3 OR window_requests < ?5)
    RETURNING requests,window_requests`).bind(hash, day, window, daily, perMinute).first();
  if (!row) throw fail('Pip request budget reached. Minute limit: ' + perMinute + '; daily limit: ' + daily + ' (UTC reset).', 429, 'rate_limit_exceeded');
  return { hash, day, remaining: daily - row.requests };
}
function record(bindings, execution, slot, usage, error = false) {
  if (!slot) return;
  const promise = bindings.DB.prepare('UPDATE pip_ai_usage SET input_tokens=input_tokens+?,output_tokens=output_tokens+?,errors=errors+? WHERE key_hash=? AND day=?').bind(usage?.prompt_tokens || 0, usage?.completion_tokens || 0, error ? 1 : 0, slot.hash, slot.day).run().catch(() => console.error({ event: 'pip-usage-write-failed' }));
  execution?.waitUntil(promise);
}
export async function aiResponse(request, bindings, execution) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/v1/')) return null;
  const protocol = path.startsWith('/v1/messages') ? 'messages' : path === '/v1/responses' ? 'responses' : 'chat';
  let slot, controller, timer, cleanup = () => {};
  try {
    const hash = await authorized(request, bindings);
    if (bindings.PIP_ENABLED === 'false') throw fail('Pip API is disabled.', 503, 'service_unavailable');
    if (path === '/v1/models' || /^\/v1\/models\/[^/]+$/.test(path)) {
      if (request.method !== 'GET') throw fail('Use GET for models.', 405);
      const models = MODELS.map(model => ({ id: model, object: 'model', created: 0, owned_by: 'jkt48connect', display_name: model, type: 'model', name: model, pip: { backend: bindings.MISTRAL_MODEL || 'mistral-medium-latest', fine_tuned: false, text: true, function_tools: true, vision: false, stateless: true } }));
      const model = path.slice('/v1/models/'.length);
      if (path !== '/v1/models' && !MODELS.includes(model)) throw fail('Unknown model.', 404, 'model_not_found');
      return Response.json(path === '/v1/models' ? { object: 'list', data: models, has_more: false, first_id: MODELS[0], last_id: MODELS.at(-1) } : models.find(m => m.id === model), { headers: HEADERS });
    }
    if (!['/v1/chat/completions', '/v1/responses', '/v1/messages', '/v1/messages/count_tokens'].includes(path)) throw fail('AI endpoint not found.', 404, 'not_found');
    if (request.method !== 'POST') throw fail('Use POST for inference.', 405);
    const body = await bodyJSON(request), n = normalize(body, protocol);
    if (!MODELS.includes(n.model)) throw fail('Unknown model. Choose pip, pip-code, or pip-docs.', 404, 'model_not_found');
    if (path.endsWith('/count_tokens')) throw fail('Exact token counting is unavailable on the current upstream. Do not treat estimates as exact.', 501, 'not_implemented');
    if (!bindings.MISTRAL_COOKIE && !bindings.MISTRAL_API_KEY) throw fail('Pip upstream is not configured.', 503, 'service_unavailable');
    slot = await reserve(bindings, hash);
    controller = new AbortController();
    timer = setTimeout(() => controller.abort(), 300000);
    const cancel = () => controller.abort();
    request.signal.addEventListener('abort', cancel, { once: true });
    cleanup = () => { clearTimeout(timer); request.signal.removeEventListener('abort', cancel); };
    const upstream = await openUpstream(n, bindings, controller);
    const headers = { ...HEADERS, 'X-Pip-Requests-Remaining-Today': String(slot.remaining), 'X-Request-Id': crypto.randomUUID() };
    if (!n.stream) {
      try { const result = await generate(n, protocol, upstream); record(bindings, execution, slot, result.usage); return Response.json(result.final, { headers }); }
      finally { cleanup(); controller.abort(); }
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(c) {
        const send = (event, data) => c.enqueue(encoder.encode((event ? 'event: ' + event + '\n' : '') + 'data: ' + (typeof data === 'string' ? data : JSON.stringify(data)) + '\n\n'));
        const heartbeat = setInterval(() => { try { c.enqueue(encoder.encode(': keep-alive\n\n')); } catch { controller.abort(); } }, 15000);
        try { const result = await generate(n, protocol, upstream, send); record(bindings, execution, slot, result.usage); }
        catch (error) { console.error({event:'pip-inference-error',request_id:headers['X-Request-Id'],phase:'stream',code:error.code||'upstream_error',upstream_status:error.upstreamStatus||null,attempts:error.attempts||null});record(bindings, execution, slot, null, true); try { const payload = errorBody(error, protocol); send('error', protocol === 'responses' ? { type: 'error', code: payload.error.code, message: payload.error.message, param: null } : payload); } catch {} }
        finally { clearInterval(heartbeat); cleanup(); controller.abort(); try { c.close(); } catch {} }
      },
      cancel() { cleanup(); controller.abort(); },
    });
    return new Response(stream, { headers: { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8' } });
  } catch (error) {
    cleanup(); clearTimeout(timer); controller?.abort(); record(bindings, execution, slot, null, true);
    console.error({event:'pip-inference-error',phase:'request',code:error.code||'upstream_error',status:error.status||502,upstream_status:error.upstreamStatus||null,attempts:error.attempts||null});
    return Response.json(errorBody(error, protocol), { status: error.status || 502, headers: { ...HEADERS, ...(error.status === 429 ? { 'Retry-After': String(error.retryAfter||60) } : {}) } });
  }
}
