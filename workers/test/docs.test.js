import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { documentation } from '../src/docs/index.js';
import { catalog } from '../src/docs/assets.js';

test('documentation serves public assets without application bindings and keeps method boundaries', async () => {
  for (const path of ['/docs','/docs/','/docs/style.css','/docs/app.js','/docs/routes.json','/docs/responses.json','/docs/guide.md']) {
    const response = documentation(new Request('https://api.test' + path));
    assert.equal(response.status,200);
    assert.ok((await response.text()).length > 10);
    assert.match(response.headers.get('Content-Security-Policy'), /script-src 'self'/);
    assert.equal(documentation(new Request('https://api.test' + path,{method:'HEAD'})).body,null);
  }
  assert.equal(documentation(new Request('https://api.test/docs/private.env')).status,404);
  assert.equal(documentation(new Request('https://api.test/docs',{method:'POST'})).status,405);
  assert.equal(documentation(new Request('https://api.test/api/news')),null);
});

test('published catalog covers every declared API route and excludes mutation from Try', async () => {
  const declared = new Set(catalog.routes.map(r => r.method + ' ' + r.path));
  assert.equal(declared.size,catalog.routes.length);
  for (const [file,prefix] of [['index','/api'],['admin','/api/admin'],['auth','/api/auth'],['user','/api/user'],['sitemap','/api/sitemap']]) {
    const source = await readFile(new URL('../src/routes/' + file + '.js',import.meta.url),'utf8');
    for (const match of source.matchAll(/app\.(get|post|put|delete)\('([^']+)'/g)) {
      const path = (prefix + match[2]).replace(/\/$/,'');
      assert.ok(declared.has(match[1].toUpperCase() + ' ' + path),path + ' missing');
    }
  }
  const source = await readFile(new URL('../src/routes/showroom.js',import.meta.url),'utf8');
  for (const match of source.matchAll(/'([^']+)':'\/api\//g)) assert.ok(declared.has('GET /api/showroom' + match[1]));
  for (const route of catalog.routes.filter(r => r.tryEnabled)) {
    assert.equal(route.method,'GET');
    assert.equal(route.auth,'Publik');
    assert.ok(!/auth|admin|turn|showroom\//.test(route.path));
  }
  assert.ok(declared.has('GET /ws'));
  assert.ok(declared.has('POST /webhook/saweria'));
});
