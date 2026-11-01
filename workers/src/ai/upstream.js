import { fail } from './protocol.js';
import { instructions } from './profile.js';

const API = 'https://api.mistral.ai/v1/chat/completions';
const CONSOLE = 'https://console.mistral.ai/api-ui/bora/v1/conversations';
// Parse SSE incrementally, including split UTF-8, CRLF, multiline data, and a final unterminated frame.
export async function* events(body) {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 2 * 1024 * 1024) throw fail('Upstream SSE frame exceeds limit.', 502, 'upstream_error');
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
        const data = frame.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (data) yield data === '[DONE]' ? { terminal: true } : JSON.parse(data);
      }
      if (done) break;
    }
    const data = buffer.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (data) yield data === '[DONE]' ? { terminal: true } : JSON.parse(data);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function upstreamSpec(n, bindings) {
  const native = Boolean(bindings.MISTRAL_API_KEY), model = bindings.MISTRAL_MODEL || 'mistral-medium-latest';
  const toolRules = n.tools.length ? 'Tool availability for this request (exact function names): ' + n.tools.map(t => t.function.name).join(', ') + '. Call only these names. A tool mentioned in conversation history or project guidance may be unavailable now. If apply_patch is absent, use an available execution tool for scoped file edits rather than inventing apply_patch.' : 'No function tools are available for this request. Do not invent tool calls.';
  const messages = [{ role: 'system', content: instructions(n.model, n.messages) }, ...n.messages, { role: 'system', content: toolRules }];
  const tools = n.tools.map(({ type, function: fn }) => ({ type, function: fn }));
  const args = { temperature: n.temperature, max_tokens: n.max };
  if (native) return { native, url: API, headers: { authorization: 'Bearer ' + bindings.MISTRAL_API_KEY }, body: { model, messages, tools, tool_choice: n.choice, ...args, stream: true, stream_options: { include_usage: true } } };
  // Console Conversations uses the same native function schemas, but entry-based history.
  const inputs = [], system = [];
  for (const m of messages) {
    if (m.role === 'system') { system.push(m.content); continue; }
    if (m.role === 'tool') { inputs.push({ object: 'entry', type: 'function.result', tool_call_id: m.tool_call_id, result: m.content }); continue; }
    if (m.content) inputs.push({ object: 'entry', type: 'message.input', role: m.role, content: m.content, prefix: false });
    for (const t of m.tool_calls || []) inputs.push({ object: 'entry', type: 'function.call', tool_call_id: t.id, name: t.function.name, arguments: t.function.arguments });
  }
  // Conversations tool_choice isn't exposed by the console. Restrict the actual tool catalogue for none/named.
  const selected = n.choice === 'none' ? [] : typeof n.choice === 'object' ? tools.filter(t => t.function.name === n.choice.function.name) : tools;
  if (n.choice === 'required' || typeof n.choice === 'object') system.push('For this turn you MUST call a supplied function tool before giving a final answer.');
  return { native, url: CONSOLE, headers: { cookie: bindings.MISTRAL_COOKIE, origin: 'https://console.mistral.ai', referer: 'https://console.mistral.ai/build/playground', 'internal-source': 'playground', 'x-metadata': JSON.stringify({ call_type: 'agent_playground' }) }, body: { model, stream: true, store: false, name: 'Pip API', instructions: system.join('\n\n'), completion_args: args, tools: selected, inputs } };
}
export async function openUpstream(n, bindings, controller) {
  const spec = upstreamSpec(n, bindings);
  let attempts = 0;
  const wait = ms => new Promise((resolve, reject) => {
    if (controller.signal.aborted) { reject(fail('Request cancelled.', 499, 'request_cancelled')); return; }
    const abort = () => { clearTimeout(timer); reject(fail('Request cancelled.', 499, 'request_cancelled')); };
    const timer = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, ms);
    controller.signal.addEventListener('abort', abort, { once: true });
  });
  async function connect(previous) {
    let error = previous;
    while (attempts < 3 && !controller.signal.aborted) {
      if (attempts) await wait(error?.retryAfter ? error.retryAfter * 1000 : 300 * 2 ** (attempts - 1));
      attempts++;
      try {
        // Stop the header timer once connected; it must not abort a healthy
        // long generation thirty seconds later while its body is streaming.
        const opening = new AbortController(), headerTimer = setTimeout(() => opening.abort(), 30000);
        let response;
        try { response = await fetch(spec.url, { method: 'POST', headers: { ...spec.headers, accept: 'text/event-stream', 'content-type': 'application/json' }, body: JSON.stringify(spec.body), signal: AbortSignal.any([controller.signal, opening.signal]) }); }
        finally { clearTimeout(headerTimer); }
        if (!response.ok) {
          // Inspect a bounded error summary only for classification. Never
          // forward provider bodies, which can contain request content.
          let contextExceeded=false;
          if([400,413,422].includes(response.status)){
            const reader=response.body?.getReader();let summary='';
            try{if(reader)while(summary.length<4096){const part=await reader.read();if(part.done)break;summary+=new TextDecoder().decode(part.value).slice(0,4096-summary.length)}}finally{await reader?.cancel().catch(()=>{});reader?.releaseLock()}
            contextExceeded=/context.{0,30}(?:exceed|length|limit)|prompt.{0,20}too long|too many tokens/i.test(summary);
          }else await response.body?.cancel();
          const status = response.status === 429 ? 429 : [400,413,422].includes(response.status) ? (response.status === 413 ? 413 : 400) : 502;
          error = fail([401, 403].includes(response.status) ? 'Pip upstream session expired. Ask the owner to refresh the Mistral credential.' : 'Pip upstream rejected the request (HTTP ' + response.status + ').' + (status === 400 ? ' Check context size and tool history; repeating the same invalid request will not help.' : ''), status, response.status === 429 ? 'rate_limit_exceeded' : status === 400 ? 'invalid_request_error' : 'upstream_error');
          error.upstreamStatus = response.status;
          if(contextExceeded){error.message='prompt is too long: the upstream context window was exceeded. Compact the conversation and retry.';error.code='context_length_exceeded';}
          const retry = response.headers.get('retry-after');
          if (retry) error.retryAfter = Math.max(1, Math.ceil(Number.isFinite(Number(retry)) ? Number(retry) : (Date.parse(retry) - Date.now()) / 1000));
          error.retryable = [408,425,429,500,502,503,504].includes(response.status) && (!error.retryAfter || error.retryAfter <= 5);
          throw error;
        }
        if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) { await response.body?.cancel(); throw Object.assign(fail('Pip upstream returned an invalid stream.', 502, 'upstream_error'), { retryable: true }); }
        return { response, native: spec.native, validToolNames: new Set(n.tools.map(t => t.function.name)), retry: connect, get attempts() { return attempts; } };
      } catch (raw) {
        error = raw.status ? raw : Object.assign(fail('Pip upstream connection was interrupted.', 502, 'upstream_connection_error'), { retryable: true });
        error.attempts = attempts;
        if (!error.retryable || controller.signal.aborted) throw error;
      }
    }
    throw error || fail('Request timed out or was cancelled.', 504, 'upstream_timeout');
  }
  return connect();
}
async function* parseDeltas(upstream) {
  const validateName = name => { if (name && upstream.validToolNames && !upstream.validToolNames.has(name)) throw Object.assign(fail('Upstream requested an unavailable tool.', 502, 'upstream_invalid_tool'), { retryable: true }); };
  let completed = false, finish = 'stop', hasTool = false;
  const toolIndexes = new Map();
  for await (const e of events(upstream.response.body)) {
    if (e.error || e.type === 'conversation.response.error') throw Object.assign(fail('Pip upstream generation failed.', 502, 'upstream_error'), { retryable: true });
    if (upstream.native) {
      if (e.terminal) { completed = true; break; }
      if (e.usage) yield { type: 'usage', usage: e.usage };
      const c = e.choices?.[0];
      if (c?.delta?.content) yield { type: 'text', delta: c.delta.content };
      for (const t of c?.delta?.tool_calls || []) { validateName(t.function?.name); hasTool = true; yield { type: 'tool', index: t.index, id: t.id, name: t.function?.name, delta: t.function?.arguments || '' }; }
      if (c?.finish_reason) { finish = c.finish_reason; completed = true; }
    } else {
      if (e.type === 'message.output.delta') {
        const delta = typeof e.content === 'string' ? e.content : e.content?.text || '';
        if (delta) yield { type: 'text', delta };
      }
      if (e.type === 'function.call.delta') {
        validateName(e.name);
        hasTool = true;
        const key = e.tool_call_id || e.id;
        if (!toolIndexes.has(key)) toolIndexes.set(key, toolIndexes.size);
        yield { type: 'tool', index: toolIndexes.get(key), id: e.tool_call_id, name: e.name, delta: typeof e.arguments === 'string' ? e.arguments : JSON.stringify(e.arguments || {}) };
      }
      if (e.type === 'conversation.response.done') { completed = true; if (e.usage) yield { type: 'usage', usage: e.usage }; break; }
    }
  }
  if (!completed) throw fail('Pip upstream disconnected before completion. No completed response was produced.', 502, 'upstream_incomplete');
  yield { type: 'finish', reason: hasTool ? 'tool_calls' : finish };
}
export async function* deltas(upstream) {
  let visible = false;
  while (true) {
    try {
      for await (const event of parseDeltas(upstream)) {
        if (event.type === 'text' || event.type === 'tool') visible = true;
        yield event;
      }
      return;
    } catch (error) {
      // Retry only before content/tool output. Replaying after output could
      // duplicate a tool call or splice two different generated answers.
      if (visible || !upstream.retry || upstream.attempts >= 3 || error.status === 400) throw error;
      upstream = await upstream.retry(error);
    }
  }
}
