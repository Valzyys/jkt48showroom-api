import { assets, catalog, responses } from './assets.js';
const routes = {
  '/docs': [assets.html, 'text/html; charset=utf-8'],
  '/docs/': [assets.html, 'text/html; charset=utf-8'],
  '/docs/style.css': [assets.css, 'text/css; charset=utf-8'],
  '/docs/app.js': [assets.script, 'text/javascript; charset=utf-8'],
  '/docs/routes.json': [JSON.stringify(catalog), 'application/json; charset=utf-8'],
  '/docs/responses.json': [JSON.stringify(responses), 'application/json; charset=utf-8'],
  '/docs/guide.md': [assets.guide, 'text/markdown; charset=utf-8']
};
export function documentation(request) {
  const path = new URL(request.url).pathname;
  if (path !== '/docs' && !path.startsWith('/docs/')) return null;
  const headers = {
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
  };
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', {status:405,headers:{...headers,Allow:'GET, HEAD'}});
  const route = routes[path];
  if (!route) return new Response('Documentation asset not found', {status:404,headers});
  return new Response(request.method === 'HEAD' ? null : route[0], {headers:{...headers,'Content-Type':route[1]}});
}
