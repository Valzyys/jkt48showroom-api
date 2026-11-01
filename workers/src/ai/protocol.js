export const fail = (message, status = 400, code = 'invalid_request_error') => Object.assign(new Error(message), { status, code });
const array = (value, name) => { if (!Array.isArray(value)) throw fail(name + ' must be an array.'); return value; };
const string = (value, name) => { if (typeof value !== 'string') throw fail(name + ' must be a string.'); return value; };
const record = (value, name) => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(name + ' must be an object.'); return value; };
export function namespaceName(namespace, name) {
  if (!namespace) return name;
  let hash = 2166136261; for (const c of namespace + '.' + name) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return 'ns_' + (hash >>> 0).toString(16) + '_' + name.slice(0, 48);
}
export function textContent(value) {
  if (typeof value === 'string') return value;
  return array(value, 'content').map(p => {
    record(p,'content block');
    if (['text', 'input_text', 'output_text'].includes(p.type)) return string(p.text, 'text');
    throw fail('This route currently supports text content only; image/audio/file content is not supported.', 400, 'unsupported_content');
  }).join('\n');
}
function toolDefinition(t, protocol, namespace) {
  if (!t || typeof t !== 'object') throw fail('Invalid tool definition.');
  if (protocol === 'messages') t = { type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } };
  const custom = t.type === 'custom';
  if (!['function', 'custom'].includes(t.type)) throw fail('Unsupported tool type: ' + t.type + '. Supply client function tools.', 400, 'unsupported_tool');
  const f = t.function || t;
  if (typeof f.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(f.name)) throw fail('Invalid tool name.');
  return { custom, namespace, clientName: f.name, type: 'function', function: { name: namespaceName(namespace, f.name), description: (namespace ? namespace + '.' + f.name + ': ' : '') + (f.description || ''), parameters: custom ? { type: 'object', properties: { input: { type: 'string', description: 'Complete raw tool input, preserving whitespace.' } }, required: ['input'] } : f.parameters || { type: 'object', properties: {} } } };
}
function responsesMessages(input) {
  if (typeof input === 'string') return [{ role: 'user', content: input }];
  return array(input, 'input').flatMap(item => {
    record(item,'input item');
    if (item.type === 'reasoning') return []; // No Mistral equivalent; encrypted reasoning is never sent upstream.
    if (['function_call', 'custom_tool_call'].includes(item.type)) return [{ role: 'assistant', content: '', tool_calls: [{ id: string(item.call_id, 'call_id'), type: 'function', function: { name: namespaceName(item.namespace, string(item.name, 'name')), arguments: item.type === 'custom_tool_call' ? JSON.stringify({ input: item.input }) : string(item.arguments, 'arguments') } }] }];
    if (['function_call_output', 'custom_tool_call_output'].includes(item.type)) return [{ role: 'tool', tool_call_id: string(item.call_id, 'call_id'), content: textContent(item.output) }];
    if (item.type && item.type !== 'message') throw fail('Unsupported Responses input item: ' + item.type);
    return [{ role: item.role, content: textContent(item.content) }];
  });
}
function anthropicMessages(input) {
  return array(input, 'messages').flatMap(m => {
    record(m,'message');
    if (typeof m.content === 'string') return [{ role: m.role, content: m.content }];
    const out = [], parts = array(m.content, 'content');
    let pending = { role: m.role, content: '' };
    for (const p of parts) {
      record(p,'content block');
      if (p.type === 'text') pending.content += string(p.text, 'text');
      else if (p.type === 'tool_use') (pending.tool_calls ||= []).push({ id: p.id, type: 'function', function: { name: p.name, arguments: JSON.stringify(p.input) } });
      else if (p.type === 'tool_result') { if (pending.content || pending.tool_calls) out.push(pending); pending = { role: m.role, content: '' }; out.push({ role: 'tool', tool_call_id: p.tool_use_id, content: typeof p.content === 'undefined' ? '' : textContent(p.content) }); }
      else if (!['thinking', 'redacted_thinking'].includes(p.type)) throw fail('Unsupported Messages content block: ' + p.type, 400, 'unsupported_content');
    }
    if (pending.content || pending.tool_calls) out.push(pending);
    return out;
  });
}
export function normalize(body, protocol) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('Expected a JSON object.');
  if (body.stream != null && typeof body.stream !== 'boolean') throw fail('stream must be true or false.');
  if (body.previous_response_id) throw fail('This is a stateless gateway. Replay prior output and tool results in input; previous_response_id is not supported.', 400, 'unsupported_parameter');
  if (body.background || body.n > 1) throw fail('background and multiple choices are not supported.');
  if (body.response_format && body.response_format.type !== 'text') throw fail('Structured response_format is not supported.', 400, 'unsupported_parameter');
  if (body.text?.format?.type && body.text.format.type !== 'text') throw fail('Structured text.format is not supported.', 400, 'unsupported_parameter');
  const messages = protocol === 'responses' ? responsesMessages(body.input) : protocol === 'messages' ? anthropicMessages(body.messages) : array(body.messages, 'messages').map(m => { record(m,'message');return { role: m.role, content: m.content == null ? '' : textContent(m.content), ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}), ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}) }; });
  const system = protocol === 'responses' ? body.instructions : protocol === 'messages' ? (body.system ? textContent(body.system) : '') : '';
  if (system) messages.unshift({ role: 'system', content: string(system, 'instructions') });
  if (!messages.length) throw fail('At least one message is required.');
  if (messages.length > 2000) throw fail('Too many messages; compact the conversation.', 413, 'context_length_exceeded');
  for (const m of messages) {
    if (!['system', 'developer', 'user', 'assistant', 'tool'].includes(m.role)) throw fail('Unsupported message role.');
    if (m.role === 'developer') m.role = 'system';
    if (m.role === 'tool') string(m.tool_call_id, 'tool_call_id');
    for (const t of m.tool_calls || []) { string(t.id, 'tool call id'); string(t.function?.name, 'tool function name'); string(t.function?.arguments, 'tool arguments'); }
  }
  const tools = array(body.tools || [], 'tools').flatMap(t => {
    if (protocol === 'responses' && t?.type === 'namespace') {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(t.name || '')) throw fail('Invalid tool namespace.');
      return array(t.tools, 'namespace tools').map(child => toolDefinition(child, protocol, t.name));
    }
    return [toolDefinition(t, protocol)];
  });
  if (tools.length > 128) throw fail('Too many tools (' + tools.length + '). Pip accepts at most 128. Disable unused Apps/MCP connectors in the client and retry.', 400, 'too_many_tools');
  if (new Set(tools.map(t => t.function.name)).size !== tools.length) throw fail('Tool names must be unique within each namespace.', 400, 'duplicate_tool_name');
  let choice = body.tool_choice || 'auto';
  if (protocol === 'messages' && typeof choice === 'object') choice = choice.type === 'tool' ? { type: 'function', function: { name: choice.name } } : choice.type === 'any' ? 'required' : choice.type;
  else if (protocol === 'responses' && choice?.type === 'function') choice = { type: 'function', function: { name: namespaceName(choice.namespace, choice.name) } };
  if (!['auto', 'none', 'required'].includes(choice) && !(choice?.type === 'function' && tools.some(t => t.function.name === choice.function?.name))) throw fail('Unsupported tool_choice.');
  const max = body.max_completion_tokens ?? body.max_output_tokens ?? body.max_tokens ?? 8192;
  if (!Number.isInteger(max) || max < 1 || max > 16384) throw fail('Output token limit must be between 1 and 16384.');
  if (body.temperature != null && (typeof body.temperature !== 'number' || body.temperature < 0 || body.temperature > 1)) throw fail('temperature must be between 0 and 1.');
  return { model: body.model || 'pip', messages, tools, choice, max, temperature: body.temperature ?? 0.2, stream: body.stream === true };
}
