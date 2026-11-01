import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { aiResponse, reserve } from '../src/ai/index.js';
import { normalize } from '../src/ai/protocol.js';
import { events, upstreamSpec, openUpstream } from '../src/ai/upstream.js';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const mf = new Miniflare({ modules: true, script: 'export default { fetch(){ return new Response("ok") } }', d1Databases: ['DB'], compatibilityDate: '2026-07-01' });
const pendingWrites = [];
after(async () => { await Promise.all(pendingWrites); await mf.dispose(); });
const DB = await mf.getD1Database('DB');
await DB.prepare(await readFile(new URL('../migrations/0016_pip_ai_usage.sql', import.meta.url), 'utf8')).run();
const key = 'pip_test_' + 'a'.repeat(40);
const bindings = { PIP_API_KEY: key, MISTRAL_COOKIE: 'private_session=never_echo', DB, PIP_REQUESTS_PER_MINUTE: '120', PIP_REQUESTS_PER_DAY: '10000' };
function sse(list, split = false) {
  const data = list.map(e => 'data: ' + (typeof e === 'string' ? e : JSON.stringify(e)) + '\r\n\r\n').join('');
  const bytes = new TextEncoder().encode(data);
  return new Response(new ReadableStream({ start(c) { if (split) { for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3)); } else c.enqueue(bytes); c.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
const textEvents = [{ type: 'message.output.delta', content: 'Halo 🌸' }, { type: 'conversation.response.done', usage: { prompt_tokens: 12, completion_tokens: 3 } }];
const ask = (path, body, extra = {}, auth = 'Bearer ' + key) => aiResponse(new Request('https://api.test' + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), { ...bindings, ...extra }, { waitUntil(promise) { pendingWrites.push(promise); } });

test('AI key is separate, mandatory, header-only, and unknown models fail', async () => {
  for (const auth of ['', 'Bearer jkc_public', 'Bearer wrong']) assert.equal((await ask('/v1/models', null, {}, auth)).status, 401);
  assert.equal((await ask('/v1/models?api_key=' + key, null, {}, '')).status, 401);
  const r = await ask('/v1/models'); assert.equal(r.status, 200);
  const models = await r.json(); assert.deepEqual(models.data.map(m => m.id), ['pip', 'pip-code', 'pip-docs']);
  assert.equal(models.data[0].pip.fine_tuned, false);
  assert.equal((await ask('/v1/models/bogus')).status, 404);
  assert.equal((await ask('/v1/responses', { model: 'bogus', input: 'Hello' })).status, 404);
  assert.equal((await ask('/v1/models', null, { PIP_ENABLED: 'false' })).status, 503);
});
test('all three JSON protocols preserve content and usage', async () => {
  globalThis.fetch = async () => sse(textEvents, true);
  for (const [path, body] of [['/v1/chat/completions', { messages: [{ role: 'user', content: 'halo' }] }], ['/v1/responses', { input: 'halo' }], ['/v1/messages', { messages: [{ role: 'user', content: 'halo' }], max_tokens: 100 }]]) {
    const r = await ask(path, body); assert.equal(r.status, 200);
    const j = await r.json(); assert.match(JSON.stringify(j), /Halo 🌸/); assert.equal(j.usage.prompt_tokens ?? j.usage.input_tokens, 12); assert.match(r.headers.get('cache-control'), /no-store/);
  }
});
test('SSE parser preserves split UTF-8, CRLF, and final frame', async () => {
  const list = []; for await (const event of events(sse(textEvents, true).body)) list.push(event);
  assert.equal(list[0].content, 'Halo 🌸');
  for await (const e of events(new Response('data: {"value":1}').body)) assert.equal(e.value, 1);
});
test('Responses streams text incrementally with terminal completion', async () => {
  globalThis.fetch = async () => sse(textEvents, true);
  const r = await ask('/v1/responses', { model: 'pip-code', input: 'halo', stream: true }); const content = await r.text();
  assert.match(content, /event: response.output_text.delta/); assert.match(content, /event: response.completed/);
  const parsed = [...content.matchAll(/^data: (.+)$/gm)].map(m => JSON.parse(m[1]));
  assert.deepEqual(parsed.map(e => e.sequence_number), parsed.map((_, i) => i)); assert.equal(parsed.at(-1).response.output[0].content[0].text, 'Halo 🌸');
});
test('native function calls survive Responses tool results and console entry conversion', async () => {
  let sent;
  globalThis.fetch = async (_, init) => { sent = JSON.parse(init.body); return sse([{ type: 'function.call.delta', tool_call_id: 'call_weather', name: 'weather', arguments: '{"city":' }, { type: 'function.call.delta', tool_call_id: 'call_weather', name: 'weather', arguments: '"Jakarta"}' }, { type: 'conversation.response.done', usage: {} }]); };
  const first = await ask('/v1/responses', { model: 'pip-code', input: 'Weather?', tools: [{ type: 'function', name: 'weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } }] }); const j = await first.json(); assert.equal(first.status, 200);
  assert.equal(j.output[0].call_id, 'call_weather'); assert.deepEqual(JSON.parse(j.output[0].arguments), { city: 'Jakarta' }); assert.equal(sent.tools[0].function.name, 'weather');
  globalThis.fetch = async (_, init) => { sent = JSON.parse(init.body); return sse(textEvents); };
  const r = await ask('/v1/responses', { input: [{ role: 'user', content: 'Weather?' }, ...j.output, { type: 'function_call_output', call_id: 'call_weather', output: '{"celsius":31}' }] }); assert.equal(r.status, 200); await r.json();
  assert.equal(sent.inputs[1].type, 'function.call'); assert.equal(sent.inputs[2].type, 'function.result'); assert.equal(sent.inputs[2].tool_call_id, 'call_weather'); assert.equal(sent.inputs[2].result, '{"celsius":31}');
});
test('Codex custom freeform tool is wrapped losslessly and roundtrips', async () => {
  const raw = '*** Begin Patch\n*** End Patch\n';
  globalThis.fetch = async () => sse([{ type: 'function.call.delta', name: 'apply_patch', tool_call_id: 'patch123', arguments: JSON.stringify({ input: raw }) }, { type: 'conversation.response.done', usage: {} }]);
  const r = await ask('/v1/responses', { input: 'Patch it', stream: true, tools: [{ type: 'custom', name: 'apply_patch', format: { type: 'text' } }] }); const text = await r.text();
  const last = [...text.matchAll(/^data: (.+)$/gm)].map(m => JSON.parse(m[1])).at(-1);
  assert.equal(last.type, 'response.completed'); assert.equal(last.response.output[0].input, raw);
  const n = normalize({ input: [...last.response.output, { type: 'custom_tool_call_output', call_id: 'patch123', output: 'ok' }] }, 'responses'); assert.equal(JSON.parse(n.messages[0].tool_calls[0].function.arguments).input, raw); assert.equal(n.messages[1].content, 'ok');
});
test('Claude Messages streams tool-use blocks and accepts tool_result', async () => {
  globalThis.fetch = async () => sse([{ type: 'function.call.delta', name: 'Read', tool_call_id: 'read123', arguments: '{"file_path":"a.js"}' }, { type: 'conversation.response.done', usage: { prompt_tokens: 10, completion_tokens: 8 } }]);
  const r = await ask('/v1/messages', { model: 'pip-code', max_tokens: 100, stream: true, messages: [{ role: 'user', content: 'Read file' }], tools: [{ name: 'Read', input_schema: { type: 'object', properties: { file_path: { type: 'string' } } } }] }); const data = await r.text(); assert.match(data, /"type":"tool_use"/); assert.match(data, /"stop_reason":"tool_use"/); assert.match(data, /event: message_stop/);
  const n = normalize({ messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'read123', name: 'Read', input: { file_path: 'a.js' } }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read123', content: [{ type: 'text', text: 'contents' }] }, { type: 'text', text: 'continue' }] }] }, 'messages'); assert.equal(n.messages[1].role, 'tool'); assert.equal(n.messages[1].content, 'contents'); assert.equal(n.messages[2].content, 'continue');
});
test('native chat forwards schemas and full coding context without truncation', () => {
  const long = 'context'.repeat(4000); const n = normalize({ model: 'pip-code', messages: [{ role: 'developer', content: long }, { role: 'user', content: 'fix' }], tools: [{ type: 'function', function: { name: 'shell', parameters: { type: 'object' } } }] }, 'chat'); const spec = upstreamSpec(n, { MISTRAL_API_KEY: 'private_key' }); assert.equal(spec.body.messages[1].content, long); assert.equal(spec.body.tools[0].function.name, 'shell'); assert.equal(spec.headers.authorization, 'Bearer private_key'); assert.doesNotMatch(spec.body.messages[0].content, /\[\[GO|\[\[POINT/);
});
test('unsupported capabilities and oversize bodies fail explicitly', async () => {
  for (const body of [{ input: 'x', previous_response_id: 'old' }, { input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'https://x/image.jpg' }] }] }, { input: 'x', tools: [{ type: 'web_search' }] }, { input: 'x', max_output_tokens: 20000 }]) assert.equal((await ask('/v1/responses', body)).status, 400);
  assert.equal((await ask('/v1/responses', { input: 'a'.repeat(1024 * 1024) })).status, 413); assert.equal((await ask('/v1/messages/count_tokens', { messages: [{ role: 'user', content: 'x' }] })).status, 501);
});
test('broken upstream never produces false completion or exposes credentials', async () => {
  globalThis.fetch = async () => sse([textEvents[0]]); const r = await ask('/v1/responses', { input: 'hello', stream: true }); const content = await r.text(); assert.match(content, /upstream_incomplete/); assert.doesNotMatch(content, /response.completed|never_echo/);
  globalThis.fetch = async () => new Response('secret stack', { status: 403 }); const error = await ask('/v1/responses', { input: 'x' }); assert.equal(error.status, 502); assert.doesNotMatch(await error.text(), /secret stack|never_echo/);
});
test('atomic D1 budget holds under concurrency and resets next minute/day', async () => {
  const cfg = { DB, PIP_REQUESTS_PER_MINUTE: '3', PIP_REQUESTS_PER_DAY: '4' }, now = Date.UTC(2026, 9, 28, 1); const all = await Promise.allSettled(Array.from({ length: 10 }, () => reserve(cfg, 'rate-test', now))); assert.equal(all.filter(r => r.status === 'fulfilled').length, 3); assert.equal(all.filter(r => r.status === 'rejected' && r.reason.status === 429).length, 7);
  await reserve(cfg, 'rate-test', now + 60000); await assert.rejects(reserve(cfg, 'rate-test', now + 120000), { status: 429 }); await reserve(cfg, 'rate-test', now + 86400000);
});

test('Responses namespaces retain identity and do not collide across tools', async () => {
  const tools = ['crm', 'billing'].map(name => ({ type: 'namespace', name, tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }] }));
  const n = normalize({ input: 'Find it', tools }, 'responses');
  assert.notEqual(n.tools[0].function.name, n.tools[1].function.name);
  globalThis.fetch = async () => sse([{ type: 'function.call.delta', name: n.tools[1].function.name, tool_call_id: 'ns1234567', arguments: '{}' }, { type: 'conversation.response.done', usage: {} }]);
  const r = await ask('/v1/responses', { input: 'Find it', tools }); const j = await r.json(); assert.equal(r.status, 200); assert.equal(j.output[0].name, 'lookup'); assert.equal(j.output[0].namespace, 'billing');
  const history = normalize({ input: [...j.output, { type: 'function_call_output', call_id: 'ns1234567', output: 'found' }], tools }, 'responses');
  assert.equal(history.messages[0].tool_calls[0].function.name, n.tools[1].function.name);
});


test('transient upstream HTTP errors recover inside one API request', async () => {
  let calls=0; globalThis.fetch=async()=>++calls===1?new Response('unavailable',{status:503}):sse(textEvents);
  const r=await ask('/v1/responses',{input:'hello'});assert.equal(r.status,200);assert.equal(calls,2);assert.equal((await r.json()).output[0].content[0].text,'Halo 🌸');
});
test('early stream failures retry but never replay after a visible token', async () => {
  let calls=0;globalThis.fetch=async()=>++calls===1?sse([{type:'conversation.response.error'}]):sse(textEvents);
  let r=await ask('/v1/messages',{messages:[{role:'user',content:'hello'}],stream:true});let text=await r.text();assert.equal(calls,2);assert.match(text,/message_stop/);assert.doesNotMatch(text,/event: error/);
  calls=0;globalThis.fetch=async()=>{calls++;return sse([textEvents[0]])};r=await ask('/v1/responses',{input:'hello',stream:true});text=await r.text();assert.equal(calls,1);assert.match(text,/upstream_incomplete/);assert.doesNotMatch(text,/response.completed/);
});
test('permanent context errors do not cause retry storms or expose provider bodies', async () => {
  let calls=0;globalThis.fetch=async()=>{calls++;return new Response('context length exceeded private_session=never_echo',{status:400})};
  const r=await ask('/v1/messages',{messages:[{role:'user',content:'hello'}]});assert.equal(r.status,400);assert.equal(calls,1);const text=await r.text();assert.match(text,/prompt is too long/);assert.doesNotMatch(text,/never_echo/);
});
test('connection header timeout is cleared for a healthy long stream', async t => {
  t.mock.timers.enable({apis:['setTimeout']});let signal;
  globalThis.fetch=async(_,init)=>{signal=init.signal;return sse(textEvents)};
  const controller=new AbortController();const upstream=await openUpstream(normalize({input:'hello'},'responses'),bindings,controller);
  t.mock.timers.tick(31000);assert.equal(signal.aborted,false);await upstream.response.body.cancel();controller.abort();assert.equal(signal.aborted,true);
});

test('oversized client tool catalogues fail with an actionable permanent error', async () => {
  const tools=Array.from({length:129},(_,i)=>({type:'function',name:'tool_'+i,parameters:{type:'object'}}));
  const r=await ask('/v1/responses',{input:'hello',tools});assert.equal(r.status,400);const j=await r.json();assert.equal(j.error.code,'too_many_tools');assert.match(j.error.message,/129.*128/);
  assert.throws(()=>normalize({input:'hello',tools:[tools[0],tools[0]]},'responses'),{code:'duplicate_tool_name'});
});
test('retry attempts are bounded and long upstream cooldowns are respected', async()=>{
  let calls=0;globalThis.fetch=async()=>{calls++;return new Response('temporary',{status:503})};
  let r=await ask('/v1/responses',{input:'hello'});assert.equal(r.status,502);assert.equal(calls,3);await r.text();
  calls=0;globalThis.fetch=async()=>{calls++;return new Response('cooldown',{status:429,headers:{'retry-after':'90'}})};
  r=await ask('/v1/messages',{messages:[{role:'user',content:'hello'}]});assert.equal(r.status,429);assert.equal(calls,1);assert.equal(r.headers.get('retry-after'),'90');await r.text();
});

test('unavailable generated tools retry before emission without exposing invented calls', async()=>{
  let calls=0;globalThis.fetch=async()=>sse([{type:'function.call.delta',tool_call_id:'abc123456',name:++calls===1?'invented_tool':'Read',arguments:'{}'},{type:'conversation.response.done'}]);
  const r=await ask('/v1/messages',{stream:true,messages:[{role:'user',content:'read'}],tools:[{name:'Read',input_schema:{type:'object'}}]});const text=await r.text();assert.equal(calls,2);assert.match(text,/"name":"Read"/);assert.doesNotMatch(text,/invented_tool|event: error/);
});
