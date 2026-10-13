import { env } from '@/runtime/env';
const rateLimit = new Set();
const maxConcurrentProcess = Number(env.MAX_CONCURRENT_PROCESS ?? 15);
export default function useRateLimit() {
    if (Number(env.ENABLE_RATE_LIMIT ?? 0) !== 1) {
        return {
            limited: false,
            clear: ()=>{}
        };
    }
    const uuid = crypto.randomUUID();
    if (rateLimit.size > maxConcurrentProcess) {
        return {
            limited: true
        };
    }
    rateLimit.add(uuid);
    return {
        limited: false,
        clear: ()=>{
            rateLimit.delete(uuid);
        }
    };
}
