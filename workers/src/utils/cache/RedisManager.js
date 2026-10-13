import { env } from '@/runtime/env';
import { Redis } from 'ioredis';
class RedisManager {
    maxRetry;
    redis;
    delay;
    constructor(){
        this.redis = new Redis(env.REDIS_URI ?? '');
        this.maxRetry = 2;
        this.delay = 1000;
    }
    sleep(ms) {
        return new Promise((resolve)=>{
            setTimeout(resolve, ms);
        });
    }
    parse(value) {
        try {
            return JSON.parse(value);
        } catch  {
            return value;
        }
    }
    async delete(key) {
        return await this.redis.del(String(key));
    }
    async get(key, withExpire = false, retry = 0) {
        if (retry > 0) await this.sleep(this.delay);
        try {
            const expireIn = await this.redis.pttl(key);
            if (expireIn <= 0) return null;
            const d = await this.redis.get(key);
            if (!d) return null;
            const data = this.parse(d);
            if (!withExpire) return data;
            return {
                expireIn,
                data
            };
        } catch (e) {
            if (retry < this.maxRetry) {
                return await this.get(key, withExpire, retry + 1);
            } else {
                throw e;
            }
        }
    }
    async set(key, value, ms = 3600000, retry = 0) {
        if (retry > 0) await this.sleep(this.delay);
        try {
            await this.redis.set(String(key), JSON.stringify(value), 'PX', ms);
        } catch (e) {
            if (retry < this.maxRetry) {
                await this.set(key, value, ms, retry + 1);
            } else {
                throw e;
            }
        }
    }
    async clear() {
        await this.redis.flushall();
    }
}
export default RedisManager;
