import { createFactory } from 'hono/factory';
import { ApiError, unauthorized } from './errorResponse';
import { isJWTValid } from './security/jwt';
import { verifySignature } from './security/signature';
import { getDurationObject, useCache } from './useCache';
import { useRateLimitSingleProcess } from './useSingleProcess';
import { security } from '@/runtime/security';
import { env } from '@/runtime/env';
import dayjs from 'dayjs';
const factory=createFactory();
export const createMiddleware=factory.createMiddleware;
export const createHandlers=factory.createHandlers;
export function handler(fetcher, options={}) {
  return createHandlers(createMiddleware(async(c,next)=>{
    const config={useJson:true,useSingleProcess:true,...(typeof options==='function'?options(c):options)};
    const privateRequest=c.req.method!=='GET'||Boolean(c.req.header('Authorization')||c.req.header('X-Refresh-Token')||c.req.header('Cookie')||c.get('user'))||/^\/api\/(auth|user|admin|showroom)(\/|$)/.test(c.req.path)||c.req.path==='/api/profile';
    for(const name of ['useRateLimit','useJson','cacheClientOnly','devCache']) c.set(name,config[name]);
    c.set('useSingleProcess',config.useSingleProcess&&!privateRequest);
    if(config.checkApiKey) {
      const token=c.req.header('x-api-key')||c.req.query('api_key');
      // A developer key that passed metering unlocks key-only routes too.
      if(env.API_CLIENT?.kind!=='key' && (!token || !(token===env.API_KEY || isJWTValid(token,env.JWT_SECRET)))) throw unauthorized();
    }
    const origins=String(env.SECONDARY_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
    const origin=c.req.header('Origin');
    const apiKey=c.req.header('x-api-key')||c.req.query('api_key');
    if(config.checkSignature && !origins.includes(origin) && !(env.API_KEY && apiKey===env.API_KEY) && env.API_CLIENT?.kind!=='key') {
      const signature=c.req.header('x-signature'),nonce=c.req.header('x-nonce'),timestamp=c.req.header('x-timestamp'),source=c.req.header('x-source');
      if(!signature||!nonce||nonce.length>256||!timestamp) throw unauthorized();
      const seconds=Number(timestamp);
      if(!Number.isSafeInteger(seconds)||Math.abs(Math.floor(Date.now()/1000)-seconds)>240) throw unauthorized();
      if(!await verifySignature(`${nonce}.${timestamp}`,signature,source)) throw unauthorized();
      if(!(await security({kind:'nonce',key:nonce,windowMs:240000})).allowed) throw unauthorized();
    }
    if(config.rateLimit) {
      const result=await security({kind:'rate',key:c.req.path+':'+(c.req.header('CF-Connecting-IP')||'unknown'),windowMs:config.rateLimit.limitTimeWindow,limit:config.rateLimit.maxRequest});
      if(!result.allowed) { c.header('Retry-After',String(result.retryAfter)); throw new ApiError({status:429,message:'Too many requests!'}); }
    }
    const seconds=dayjs.duration(getDurationObject(config)).asSeconds();
    if(privateRequest) c.header('Cache-Control','no-store');
    else if(seconds>0) c.header('Cache-Control',`max-age=${Math.floor(seconds)}, must-revalidate`);
    return next();
  }),useCache(options),useRateLimitSingleProcess(fetcher));
}
