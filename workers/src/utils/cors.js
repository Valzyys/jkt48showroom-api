import { cors } from 'hono/cors';
import { env } from '@/runtime/env';
export function useCORS(level) {
  return (c,next) => cors({
    allowMethods:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowHeaders:['Content-Type','Authorization','X-Refresh-Token','X-SR-Token','X-API-Key','X-Signature','X-Nonce','X-Source','X-Timestamp','X-Requested-With','Range','If-Range','If-None-Match'],
    exposeHeaders:['X-Access-Token','X-Refresh-Token','X-SR-Token','Content-Range','Accept-Ranges'],
    credentials:level==='self',
    origin:origin => {
      const origins=[env.ORIGINS,env.SECONDARY_ORIGINS].filter(Boolean).flatMap(v=>v.split(',')).map(v=>v.trim());
      if (level==='all') return origin || '*';
      return origins.includes(origin) ? origin : '';
    },
    maxAge:600
  })(c,next);
}
