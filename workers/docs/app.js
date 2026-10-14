const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const response = await fetch('/docs/routes.json');
if (!response.ok) throw new Error('Katalog dokumentasi tidak tersedia.');
const catalog = await response.json();
$('#route-count').textContent = catalog.routes.length;
const groups = ['Publik', 'User', 'Showroom', 'Admin', 'Realtime', 'Webhook', 'Media', 'Control', 'Collector'];
let active = null;
let language = 'curl';
let code = '';
const routeHash = (r) => '#route=' + encodeURIComponent(r.method + ' ' + r.path);
function nav() {
  const query = $('#search').value.toLowerCase();
  const method = $('#method').value;
  $('#route-list').innerHTML = groups.map((group) => {
    const routes = catalog.routes.filter((r) => r.group === group && (!method || r.method === method) && (r.path + ' ' + r.description + ' ' + r.auth).toLowerCase().includes(query));
    return routes.length ? `<div class="group-title">${esc(group)} <span>· ${routes.length}</span></div>` + routes.map((r) => `<a class="route-link ${active?.method === r.method && active?.path === r.path ? 'active' : ''}" href="${routeHash(r)}"><span class="method ${r.method}">${r.method}</span><span>${esc(r.path)}</span></a>`).join('') : '';
  }).join('') || '<p class="empty">Tidak ada route yang cocok.</p>';
}
function short(value, depth = 0) {
  if (Array.isArray(value)) return value.slice(0, 1).map((v) => short(v, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,short(v,depth+1)]));
  return typeof value === 'string' && value.length > 700 ? value.slice(0,700) + '… [dipersingkat]' : value;
}
function values() {
  return [...document.querySelectorAll('[data-param]')].map((input) => ({ name: input.dataset.param, kind: input.dataset.kind, value: input.value }));
}
function requestUrl() {
  let path = active.examplePath;
  for (const v of values().filter(v => v.kind === 'path')) path = path.replace(':' + v.name, encodeURIComponent(v.value));
  const url = new URL(path, location.origin);
  for (const v of values().filter(v => v.kind === 'query' && v.value !== '')) url.searchParams.set(v.name, v.value);
  return url;
}
const quote = (value) => "'" + String(value).replaceAll("'", "'\\''") + "'";
function headers() {
  const h = {};
  if (/User token|Admin token/.test(active.auth)) h.Authorization = 'Bearer ACCESS_TOKEN';
  if (/API key \/ /.test(active.auth)) h['x-api-key'] = 'SERVER_API_KEY';
  if (active.contentType && active.contentType !== 'multipart/form-data') h['Content-Type'] = active.contentType;
  if (active.contentType === 'multipart/form-data' || active.contentType === 'application/x-www-form-urlencoded') h.Origin = 'http://localhost:3000';
  if (active.group === 'Webhook') h['Saweria-Callback-Signature'] = 'SIGNATURE_HEX';
  if (active.group === 'Collector') h.Authorization = 'Bearer COLLECTOR_TOKEN';
  if (active.group === 'Control' && active.method !== 'GET') h.Origin = location.origin;
  return h;
}
function requestCode() {
  if (active.path === '/ws') return "import { encode, decode } from 'cbor-x';\nconst socket = new WebSocket('wss://' + location.host + '/ws?token=JWT');\nsocket.binaryType = 'arraybuffer';\nsocket.onopen = () => socket.send(encode('listen jkt48'));\nsocket.onmessage = event => console.log(decode(new Uint8Array(event.data)));";
  const url = requestUrl().href;
  const h = headers();
  const body = active.body;
  if (language === 'curl') {
    let s = 'curl ' + (active.group === 'Control' ? (active.path === '/control/api/login' ? '-c control-cookies.txt ' : '-b control-cookies.txt ') : '') + (active.method === 'HEAD' ? '-I ' : active.method !== 'GET' ? '-X ' + active.method + ' ' : '') + quote(url);
    for (const [k,v] of Object.entries(h)) s += ' \\\n  -H ' + quote(k + ': ' + v);
    if (body && active.contentType === 'application/json') s += ' \\\n  --data ' + quote(JSON.stringify(body));
    else if (body) for (const [k,v] of Object.entries(body)) for (const val of Array.isArray(v) ? v : [v]) s += ' \\\n  ' + (active.contentType === 'multipart/form-data' ? '-F ' : '--data-urlencode ') + quote(k + '=' + val);
    return s;
  }
  let prefix = '';
  let bodyCode = '';
  if (body && active.contentType === 'application/json') bodyCode = 'JSON.stringify(' + JSON.stringify(body, null, 2) + ')';
  else if (body) {
    prefix = active.contentType === 'multipart/form-data' ? 'const body = new FormData();\n' : 'const body = new URLSearchParams();\n';
    for (const [k,v] of Object.entries(body)) for (const val of Array.isArray(v) ? v : [v]) prefix += 'body.append(' + JSON.stringify(k) + ', ' + (String(val).startsWith('@') ? 'fileInput.files[0] /* File ' + val.slice(1) + ' */' : JSON.stringify(val)) + ');\n';
    bodyCode = 'body';
  }
  return prefix + 'const response = await fetch(' + JSON.stringify(url) + ', {\n  method: ' + JSON.stringify(active.method) + ',\n  headers: ' + JSON.stringify(h, null, 2) + (bodyCode ? ',\n  body: ' + bodyCode : '') + '\n});\nconst text = await response.text();\nif (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);\nconsole.log(text);';
}
function refreshCode() {
  code = requestCode();
  $('#request-code').textContent = code;
}
function selectRoute() {
  const raw = location.hash.startsWith('#route=') ? location.hash.slice(7) : '';
  let key;
  try { key = decodeURIComponent(raw); } catch { return; }
  active = catalog.routes.find((r) => r.method + ' ' + r.path === key);
  nav();
  if (!active) return;
  $('#section-title').textContent = active.group;
  $('#auth-label').textContent = active.auth;
  const params = Object.entries(active.query).map(([name,value]) => ({name,value,kind:'query'}));
  let path = active.examplePath;
  for (const name of [...active.path.matchAll(/:([a-z_]+)/g)].map(m => m[1])) {
    const value = name === 'path' ? 'media/jkt48-member/anindya_ramadhani.jpg' : ['/api/theater/:id','/api/news/:id'].includes(active.path) ? active.examplePath.split('/').pop() : name === 'fingerprint' ? 'DEVICE_FINGERPRINT' : name === 'data_id' ? 'DATA_ID' : 'ID';
    params.unshift({name,value,kind:'path'});
  }
  // Inputs use the route template; example values are applied when constructing the URL.
  active = {...active, examplePath: active.path};
  const payload = active.body ? '<h3>Request body · ' + esc(active.contentType) + '</h3><pre><code>' + esc(JSON.stringify(active.body, null, 2)) + '</code></pre><p class="description">Placeholder ID/file perlu diganti. Field opsional dijelaskan di ringkasan route dan panduan Markdown.</p>' : '';
  const success = active.successExample ? '<h3>Contoh sukses · berdasarkan source, belum diuji produksi</h3><pre><code>' + esc(JSON.stringify(active.successExample,null,2)) + '</code></pre>' : '';
  const output = active.response ? JSON.stringify(short(active.response.body), null, 2) : 'Belum tersedia contoh output produksi untuk route ini.\nBentuk sukses mengikuti handler pada source; autentikasi dan resource yang sesuai diperlukan.';
  $('#endpoint').innerHTML = `<div class="endpoint-path"><span class="method ${active.method}">${active.method}</span><code>${esc(active.path)}</code></div><p class="description">${esc(active.description)}</p>${params.length ? '<h3>Parameter</h3><table class="params"><thead><tr><th>Nama</th><th>Lokasi</th><th>Contoh nilai</th></tr></thead><tbody>' + params.map(p => `<tr><td><code>${esc(p.name)}</code></td><td>${p.kind}</td><td><input data-param="${esc(p.name)}" data-kind="${p.kind}" value="${esc(p.value)}" aria-label="${esc(p.name)}"></td></tr>`).join('') + '</tbody></table>' : '<p class="description">Tidak ada parameter wajib yang didokumentasikan pada contoh dasar ini.</p>'}${payload}<div class="tabs"><button id="curl" class="${language === 'curl' ? 'selected' : ''}">cURL</button><button id="javascript" class="${language === 'javascript' ? 'selected' : ''}">JavaScript</button></div><div class="code-head"><span>Contoh pemanggilan · placeholder autentikasi</span><button id="copy-request">Salin kode</button></div><pre><code id="request-code"></code></pre><div class="code-head"><span>${esc(active.responseLabel)}${active.response ? ' · HTTP ' + active.response.status : ''}</span>${active.tryEnabled ? '<button id="run">Coba GET ↗</button>' : '<span>Contoh saja</span>'}</div><pre><code id="output">${esc(output)}</code></pre><p class="description">Preview array maksimal satu item. Respons lengkap ada pada unduhan; hasil “Coba GET” ditampilkan lengkap.</p>${success}<a class="source-link" href="${esc(active.source)}" target="_blank" rel="noopener">Lihat implementasi di GitHub ↗</a>`;
  document.querySelectorAll('[data-param]').forEach(input => input.addEventListener('input', refreshCode));
  for (const l of ['curl','javascript']) $('#' + l).onclick = () => { language = l; document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('selected', b.id === l)); refreshCode(); };
  $('#copy-request').onclick = () => copy(code);
  if ($('#run')) $('#run').onclick = async () => {
    const button = $('#run');
    button.disabled = true; button.textContent = 'Sedang memuat…';
    try {
      const url = requestUrl();
      if (url.origin !== location.origin || !active.tryEnabled || active.method !== 'GET') throw new Error('Route tidak dapat dicoba.');
      const result = await fetch(url, {signal:AbortSignal.timeout(45000), credentials:'omit'});
      const text = await result.text();
      let body; try { body = JSON.stringify(JSON.parse(text),null,2); } catch { body = text; }
      $('#output').textContent = 'HTTP ' + result.status + '\n\n' + body;
    } catch(e) { $('#output').textContent = 'Request gagal: ' + e.message; }
    finally { button.disabled = false; button.textContent = 'Coba GET ↗'; }
  };
  refreshCode();
  $('#reference').scrollIntoView({behavior:'smooth', block:'start'});
  $('#sidebar').classList.remove('open'); $('#menu').setAttribute('aria-expanded','false');
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); $('#toast').textContent = 'Disalin ke clipboard'; } catch { $('#toast').textContent = 'Clipboard tidak tersedia; salin teks secara manual.'; }
  $('#toast').classList.add('show'); setTimeout(() => $('#toast').classList.remove('show'),2200);
}
$('#copy-base').onclick = () => copy(location.origin);
$('#base').textContent = location.origin;
$('#search').oninput = nav;
$('#method').onchange = nav;
$('#menu').onclick = () => { const open = $('#sidebar').classList.toggle('open'); $('#menu').setAttribute('aria-expanded',String(open)); };
window.addEventListener('hashchange',selectRoute);
nav(); selectRoute();
