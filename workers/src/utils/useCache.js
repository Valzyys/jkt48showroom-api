import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import cache from './cache';
import { background } from '@/runtime/env';
dayjs.extend(duration);
const units = ['milliseconds','seconds','minutes','hours','days','months','years','weeks'];
export function getDurationObject(options = {}) { return Object.fromEntries(Object.entries(options).filter(([key]) => units.includes(key))); }
export function useCache(options) {
  return async (c,next) => {
    const config = typeof options === 'function' ? options(c) : options || {};
    const ttl = dayjs.duration(getDurationObject(config)).asMilliseconds();
    const privateRequest = c.req.method !== 'GET' || c.req.header('Authorization') || c.req.header('X-Refresh-Token') || c.req.header('Cookie') || c.get('user') || /^\/api\/(auth|user|admin|showroom)(\/|$)/.test(c.req.path) || c.req.path === '/api/profile';
    if (privateRequest) { c.header('Cache-Control','no-store'); await next(); c.header('Cache-Control','no-store'); return; }
    if (!ttl || c.get('cacheClientOnly') || config.useJson === false) return next();
    const key = config.name || c.req.url;
    const cached = await cache.get(key);
    if (cached !== null) return c.json(cached);
    await next();
    if (c.res.status === 200 && !c.res.headers.has('Set-Cookie')) {
      const value = await c.res.clone().json();
      background(cache.set(key,value,ttl));
    }
  };
}
