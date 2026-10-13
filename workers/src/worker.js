import { runWithEnv, env } from './runtime/env.js';
import { streamProxy } from './runtime/proxy-core.js';
import { ensureJKT48 } from './library/jkt48/scraper/sync.js';
export { LiveHub } from './live-hub.js';
export { Coordinator } from './coordinator.js';

let appPromise;
export function getApp() {
  appPromise ||= (async()=>{
    const [{Hono},{default:api},{default:webhook},{ApiError},{FetchError}]=await Promise.all([
      import('hono'),import('./routes/index.js'),import('./webhooks/index.js'),import('./utils/errorResponse.js'),import('./runtime/http.js')
    ]);
    const app=new Hono();
    app.get('/',c=>c.json({author:'crstlnz',website:'https://48live.my.id',version:'0.14.2-workers.1'}));
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
    return runWithEnv(bindings,execution,async()=>{
      const url=new URL(request.url);
      if(url.pathname==='/health') {
        try { if(!bindings.DB) throw new Error('Missing DB'); await bindings.DB.prepare('SELECT 1 FROM documents LIMIT 1').first(); return Response.json({ok:true,runtime:'cloudflare-workers'}); }
        catch { return Response.json({ok:false,runtime:'cloudflare-workers',message:'Database is not initialized'},{status:503}); }
      }
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
        return (await getApp()).fetch(request,bindings,execution);
      } catch(error) {
        const status=error.status||500;
        const response=Response.json({status,message:status<500||status===502||status===504?error.message:'An error occurred!',path:url.pathname},{status});
        return url.pathname==='/api/stream'?cors(response,request,bindings):response;
      }
    });
  },
  async scheduled(event,bindings,execution) {
    return runWithEnv(bindings,execution,async()=>{
      execution.waitUntil(bindings.LIVE_HUB.get(bindings.LIVE_HUB.idFromName('global')).fetch('https://live.internal/refresh',{method:'POST'}));
      execution.waitUntil(bindings.DB.prepare('DELETE FROM cache_entries WHERE expires_at<=?').bind(Date.now()).run());
      for(const dataset of ['news','schedules','members'])execution.waitUntil(ensureJKT48(dataset).catch(error=>console.error({event:'jkt48-cron-failed',dataset,message:error.message})));
      // The source leaves competition/monthly jobs disabled. Enable explicitly.
      if(bindings.ENABLE_COMPETITION_CRON==='true') execution.waitUntil((async()=>{await getApp(); const {scrapeAndStoreCompetitionRanking}=await import('./library/showroomCompetition/ranking.js'); await scrapeAndStoreCompetitionRanking();})());
    });
  }
};
