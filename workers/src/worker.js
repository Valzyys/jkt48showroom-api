import {serveTheaterScreenshot} from './collector/theater.js';
import {licenseResponse} from './licenses/index.js';
import {serveGiftImage} from './runtime/gift-media';
import { collectorResponse, cleanupCollectorUploads } from './collector/index.js';
import { controlResponse } from './control/index.js';
import { effectiveBindings } from './control/settings.js';
import { serveMedia, rewriteMediaResponse } from './runtime/jkt48-media.js';
import { documentation } from './docs/index.js';
import { accountResponse } from './accounts/index.js';
import { meter } from './accounts/metering.js';
import { withoutKeyParams } from './accounts/capture.js';
import { isJWTValid } from './utils/security/jwt.js';
import { verifySignature } from './utils/security/signature.js';
import { runWithEnv, env } from './runtime/env.js';
import { streamProxy } from './runtime/proxy-core.js';
import { ensureJKT48 } from './library/jkt48/scraper/sync.js';
import { publicSyncError } from './runtime/sync-errors.js';
export { LiveHub } from './live-hub.js';
export { Coordinator } from './coordinator.js';

let appPromise;
export function getApp() {
  appPromise ||= (async()=>{
    const [{Hono},{default:api},{default:webhook},{ApiError},{FetchError}]=await Promise.all([
      import('hono'),import('./routes/index.js'),import('./webhooks/index.js'),import('./utils/errorResponse.js'),import('./runtime/http.js')
    ]);
    const app=new Hono();
    app.get('/',c=>c.json({author:'valzy',website:'https://jkt48connect.com',version:'0.14.2-workers.1'}));
    app.use('*',async(c,next)=>{
      c.header('X-Content-Type-Options','nosniff');
      const privateRequest=c.req.method!=='GET'||Boolean(c.req.header('Authorization')||c.req.header('X-Refresh-Token')||c.req.header('Cookie'))||/^\/api\/(auth|user|admin|showroom)(\/|$)/.test(c.req.path)||c.req.path==='/api/profile';
      if(privateRequest)c.header('Cache-Control','no-store');
      await next();
      if(privateRequest)c.header('Cache-Control','no-store');
    });
    app.route('/api',api);
    app.route('/webhook',webhook);
    app.notFound(c=>c.json({status:404,message:'Endpoint not found!',path:c.req.path},404));
    app.onError((error,c)=>{
      const sourceError=publicSyncError(error,c.req.path);
      if(sourceError){c.header('Cache-Control','no-store');if(error.retryAfter)c.header('Retry-After',String(error.retryAfter));return c.json(sourceError,error.status);}
      const status=error instanceof ApiError?error.data.status:error.status||error.statusCode||500;
      const code=Number.isInteger(status)&&status>=400&&status<=599?status:500;
      const message=error instanceof ApiError?error.data.message:error instanceof FetchError?'Upstream request failed':code<500?error.message:'An error occurred!';
      if(env.LOG==='true') console.error({path:c.req.path,status:code,error:error.name});
      return c.json({status:code,message,path:c.req.path},code);
    });
    return app;
  })();
  return appPromise;
}
function cors(response,request,bindings) {
  const headers=new Headers(response.headers), origin=request.headers.get('Origin');
  const allowed=String(bindings.ORIGINS||'').split(',').map(x=>x.trim());
  if(origin && allowed.includes(origin)) { headers.set('Access-Control-Allow-Origin',origin); headers.set('Vary','Origin'); }
  headers.set('Access-Control-Allow-Methods','GET,HEAD,OPTIONS');
  headers.set('Access-Control-Allow-Headers','Range,If-Range,If-None-Match,If-Modified-Since');
  headers.set('Access-Control-Expose-Headers','Content-Range,Accept-Ranges');
  return new Response(response.body,{status:response.status,headers});
}
export default {
  async fetch(request,bindings,execution) {
    const incoming=new URL(request.url);if(incoming.hostname==='apitest.jkt48connect.com'&&!incoming.pathname.startsWith('/internal/collector/')){incoming.hostname='api.jkt48connect.app';return new Response(null,{status:308,headers:{Location:incoming.href,'Cache-Control':'no-store'}});}
    const collector = await collectorResponse(request,bindings,execution);
    if (collector) return collector;
    const docs = await documentation(request,bindings);
    if (docs) return docs;
    const control = await controlResponse(request,bindings,execution);
    if (control) return rewriteMediaResponse(control,request);
    bindings = await effectiveBindings(bindings);
    const theaterScreenshot=await serveTheaterScreenshot(request,bindings);if(theaterScreenshot)return theaterScreenshot;
    const license = await licenseResponse(request,bindings);if(license)return license;
    const account = await accountResponse(request,bindings);
    if (account) return account;
    const giftMedia=await serveGiftImage(request,bindings);if(giftMedia)return giftMedia;
    const media = await serveMedia(request,bindings);
    if (media) return media;
    const scope={...bindings,REQUEST_ORIGIN:new URL(request.url).origin};
    return runWithEnv(scope,execution,async()=>{
      const url=new URL(request.url);
      if(url.pathname==='/health') {
        try { if(!bindings.DB) throw new Error('Missing DB'); await bindings.DB.prepare('SELECT 1 FROM documents LIMIT 1').first(); return Response.json({ok:true,runtime:'cloudflare-workers'}); }
        catch { return Response.json({ok:false,runtime:'cloudflare-workers',message:'Database is not initialized'},{status:503}); }
      }
      // Developer API keys: count the request against its monthly quota.
      const metered=await meter(request,bindings,execution,{jwt:isJWTValid,signature:verifySignature});
      if(metered.response) return cors(metered.response,request,bindings);
      scope.API_CLIENT=metered.client;
      // A developer key in the query is spent here; routes and caches never see it.
      if(metered.client?.kind==='key')request=withoutKeyParams(request);
      return metered.finish(await (async()=>{
      try {
        if(url.pathname==='/api/stream') {
          if(request.method==='OPTIONS') return cors(new Response(null,{status:204}),request,bindings);
          return cors(await streamProxy(request,bindings),request,bindings);
        }
        for(const name of ['SECRET','AUTH_SECRET','JWT_SECRET','API_KEY']) if(!bindings[name]) return Response.json({status:503,message:'Worker secrets are not configured',path:url.pathname},{status:503});
        if(request.method==='GET') {
          if(/^\/api\/news(?:\/|$)/.test(url.pathname))await ensureJKT48('news');
          if(/^\/api\/(theater|event|jkt48event|next_schedule|setlist)(?:\/|$)/.test(url.pathname))await ensureJKT48('schedules');
          if(/^\/api\/(member|birthday|next_birthday|48\/member|first_data)(?:\/|$)/.test(url.pathname)&&(!url.searchParams.get('group')||url.searchParams.get('group')==='jkt48'))await ensureJKT48('members');
        }
        if(url.pathname==='/ws' || url.pathname==='/ws/') {
          if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket') return new Response('WebSocket upgrade required',{status:426});
          return bindings.LIVE_HUB.get(bindings.LIVE_HUB.idFromName('global')).fetch(new Request(new URL('/ws'+url.search,request.url),request));
        }
        if(url.pathname==='/api/beta' || /^\/api\/admin\/beta(?:_device)?(?:\/|$)/.test(url.pathname)) return bindings.COORDINATOR.get(bindings.COORDINATOR.idFromName('global')).fetch(request);
        return rewriteMediaResponse(await (await getApp()).fetch(request,bindings,execution),request);
      } catch(error) {
        const sourceError=publicSyncError(error,url.pathname);
        if(sourceError)return cors(Response.json(sourceError,{status:error.status,headers:{'Cache-Control':'no-store',...(error.retryAfter?{'Retry-After':String(error.retryAfter)}:{})}}),request,bindings);
        const status=error.status||500;
        const response=Response.json({status,message:status<500||status===502||status===504?error.message:'An error occurred!',path:url.pathname},{status});
        return url.pathname==='/api/stream'?cors(response,request,bindings):response;
      }
      })());
    });
  },
  async scheduled(event,bindings,execution) {
    bindings = await effectiveBindings(bindings);
    return runWithEnv({...bindings,REQUEST_ORIGIN:new URL(request.url).origin},execution,async()=>{
      execution.waitUntil(bindings.LIVE_HUB.get(bindings.LIVE_HUB.idFromName('global')).fetch('https://live.internal/refresh',{method:'POST'}));
      execution.waitUntil(cleanupCollectorUploads(bindings));
      execution.waitUntil(bindings.DB.prepare('DELETE FROM cache_entries WHERE expires_at<=?').bind(Date.now()).run());
      for(const dataset of ['news','schedules','members'])execution.waitUntil(ensureJKT48(dataset).catch(error=>console.error({event:'jkt48-cron-failed',dataset,message:error.message})));
      // The source leaves competition/monthly jobs disabled. Enable explicitly.
      if(bindings.ENABLE_COMPETITION_CRON==='true') execution.waitUntil((async()=>{await getApp(); const {scrapeAndStoreCompetitionRanking}=await import('./library/showroomCompetition/ranking.js'); await scrapeAndStoreCompetitionRanking();})());
    });
  }
};
