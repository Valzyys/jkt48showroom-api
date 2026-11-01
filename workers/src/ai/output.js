import { fail, namespaceName } from './protocol.js';
import { deltas } from './upstream.js';

const id = prefix => prefix + crypto.randomUUID().replaceAll('-', '');
export function usageOf(u = {}) {
  const input = u.prompt_tokens ?? u.input_tokens ?? 0, output = u.completion_tokens ?? u.output_tokens ?? 0;
  return { prompt_tokens: input, completion_tokens: output, total_tokens: u.total_tokens ?? input + output };
}
export function errorBody(error, protocol) {
  const safe = error.status ? error : fail('Pip generation failed or timed out.', 502, 'upstream_error');
  const payload = { message: safe.message, type: safe.code || 'api_error', code: safe.code || 'api_error', param: null };
  if(protocol==='messages'){
    const status=safe.status||502;
    const type=status===401?'authentication_error':status===403?'permission_error':status===404?'not_found_error':status===413?'request_too_large':status===429?'rate_limit_error':status>=500?'api_error':'invalid_request_error';
    return {type:'error',error:{...payload,type}};
  }
  return { error: payload };
}
export async function generate(n, protocol, upstream, send = () => {}) {
  const responseId = id(protocol === 'messages' ? 'msg_' : protocol === 'responses' ? 'resp_' : 'chatcmpl-'), created = Math.floor(Date.now() / 1000);
  const items = [], tools = new Map();
  let textItem, usage = usageOf(), reason = 'stop', sequence = 0;
  const emit = (type, value) => send(protocol === 'chat' ? '' : type, protocol === 'responses' ? { type, sequence_number: sequence++, ...value } : protocol === 'messages' ? { type, ...value } : value);
  const result = status => ({ id: responseId, object: 'response', created_at: created, status, model: n.model, output: items, parallel_tool_calls: true, tool_choice: n.choice, error: null, incomplete_details: status === 'incomplete' ? { reason: 'max_output_tokens' } : null, usage: { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens, total_tokens: usage.total_tokens, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } }, store: false });
  const chat = (delta, finish_reason = null, extra = {}) => ({ id: responseId, object: 'chat.completion.chunk', created, model: n.model, choices: [{ index: 0, delta, finish_reason }], ...extra });
  if (protocol === 'responses') { emit('response.created', { response: result('in_progress') }); emit('response.in_progress', { response: result('in_progress') }); }
  else if (protocol === 'messages') emit('message_start', { message: { id: responseId, type: 'message', role: 'assistant', content: [], model: n.model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
  else emit('', chat({ role: 'assistant', content: '' }));
  for await (const e of deltas(upstream)) {
    if (e.type === 'usage') { usage = usageOf(e.usage); continue; }
    if (e.type === 'finish') { reason = e.reason; continue; }
    if (e.type === 'text') {
      if (!textItem) {
        textItem = { id: id('msg_'), type: 'message', status: 'in_progress', role: 'assistant', content: [{ type: 'output_text', text: '', annotations: [] }] };
        items.push(textItem); const index = items.indexOf(textItem);
        if (protocol === 'responses') { emit('response.output_item.added', { output_index: index, item: structuredClone(textItem) }); emit('response.content_part.added', { item_id: textItem.id, output_index: index, content_index: 0, part: structuredClone(textItem.content[0]) }); }
        if (protocol === 'messages') emit('content_block_start', { index, content_block: { type: 'text', text: '' } });
      }
      textItem.content[0].text += e.delta;
      const index = items.indexOf(textItem);
      if (protocol === 'responses') emit('response.output_text.delta', { item_id: textItem.id, output_index: index, content_index: 0, delta: e.delta });
      else if (protocol === 'messages') emit('content_block_delta', { index, delta: { type: 'text_delta', text: e.delta } });
      else emit('', chat({ content: e.delta }));
    }
    if (e.type === 'tool') {
      let tool = tools.get(e.index);
      if (!tool) {
        if (!e.id || !e.name) throw fail('Upstream returned an incomplete tool identity.', 502, 'upstream_error');
        const definition = n.tools.find(t => t.function.name === e.name);
        if (!definition || n.choice === 'none') throw fail('Upstream returned an unrequested tool.', 502, 'upstream_error');
        tool = { id: id(definition.custom ? 'ctc_' : 'fc_'), type: definition.custom ? 'custom_tool_call' : 'function_call', status: 'in_progress', call_id: e.id, name: definition.clientName, ...(definition.namespace ? { namespace: definition.namespace } : {}), ...(definition.custom ? { input: '' } : { arguments: '' }) };
        tools.set(e.index, tool); items.push(tool);
        if (protocol === 'responses') emit('response.output_item.added', { output_index: items.indexOf(tool), item: structuredClone(tool) });
        else if (protocol === 'messages') emit('content_block_start', { index: items.indexOf(tool), content_block: { type: 'tool_use', id: tool.call_id, name: tool.name, input: {} } });
        else emit('', chat({ tool_calls: [{ index: e.index, id: tool.call_id, type: 'function', function: { name: tool.name, arguments: '' } }] }));
      }
      if (tool.type === 'custom_tool_call') tool.input += e.delta; else tool.arguments += e.delta;
      if (protocol === 'responses' && tool.type === 'function_call') emit('response.function_call_arguments.delta', { item_id: tool.id, output_index: items.indexOf(tool), delta: e.delta });
      else if (protocol === 'messages') emit('content_block_delta', { index: items.indexOf(tool), delta: { type: 'input_json_delta', partial_json: e.delta } });
      else if (protocol === 'chat') emit('', chat({ tool_calls: [{ index: e.index, function: { arguments: e.delta } }] }));
    }
  }
  if (!items.length) throw fail('Upstream returned no output.', 502, 'upstream_error');
  if (n.choice === 'required' && !tools.size || typeof n.choice === 'object' && ![...tools.values()].some(t => namespaceName(t.namespace, t.name) === n.choice.function.name)) throw fail('Upstream did not honor the required tool choice.', 502, 'upstream_error');
  const limited = reason === 'length' || (usage.completion_tokens >= n.max && !tools.size);
  for (let index = 0; index < items.length; index++) {
    const item = items[index]; item.status = limited ? 'incomplete' : 'completed';
    if (item.type === 'custom_tool_call') {
      let raw; try { raw = JSON.parse(item.input).input; } catch { throw fail('Upstream returned invalid custom tool arguments.', 502, 'upstream_error'); }
      if (typeof raw !== 'string') throw fail('Upstream returned invalid custom tool input.', 502, 'upstream_error');
      item.input = raw;
      if (protocol === 'responses') { emit('response.custom_tool_call_input.delta', { item_id: item.id, output_index: index, delta: raw }); emit('response.custom_tool_call_input.done', { item_id: item.id, output_index: index, input: raw }); }
    } else if (item.type === 'function_call') {
      if (!limited) try { JSON.parse(item.arguments); } catch { throw fail('Upstream returned invalid tool JSON.', 502, 'upstream_error'); }
      if (protocol === 'responses') emit('response.function_call_arguments.done', { item_id: item.id, output_index: index, arguments: item.arguments });
    } else if (protocol === 'responses') { emit('response.output_text.done', { item_id: item.id, output_index: index, content_index: 0, text: item.content[0].text }); emit('response.content_part.done', { item_id: item.id, output_index: index, content_index: 0, part: item.content[0] }); }
    if (protocol === 'responses') emit('response.output_item.done', { output_index: index, item });
    if (protocol === 'messages') emit('content_block_stop', { index });
  }
  const response = result(limited ? 'incomplete' : 'completed');
  let final;
  if (protocol === 'responses') { emit(limited ? 'response.incomplete' : 'response.completed', { response }); final = response; }
  else if (protocol === 'messages') {
    const stop = limited ? 'max_tokens' : tools.size ? 'tool_use' : 'end_turn';
    final = { id: responseId, type: 'message', role: 'assistant', model: n.model, content: items.map(i => i.type === 'message' ? { type: 'text', text: i.content[0].text } : { type: 'tool_use', id: i.call_id, name: i.name, input: JSON.parse(i.arguments) }), stop_reason: stop, stop_sequence: null, usage: { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens } };
    emit('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: final.usage }); emit('message_stop', {});
  } else {
    const finish = limited ? 'length' : tools.size ? 'tool_calls' : 'stop';
    final = { id: responseId, object: 'chat.completion', created, model: n.model, choices: [{ index: 0, message: { role: 'assistant', content: textItem?.content[0].text || (tools.size ? null : ''), ...(tools.size ? { tool_calls: [...tools.values()].map(t => ({ id: t.call_id, type: 'function', function: { name: t.name, arguments: t.arguments ?? JSON.stringify({ input: t.input }) } })) } : {}) }, finish_reason: finish }], usage };
    emit('', chat({}, finish)); emit('', { ...chat({}), choices: [], usage }); send('', '[DONE]');
  }
  return { final, usage };
}
