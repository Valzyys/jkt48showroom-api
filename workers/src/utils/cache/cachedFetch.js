class Cache {
    store = new Map();
    flights = new Map();
    defaultTTL;
    constructor(ttlMs = 1000 * 60 * 60 * 3){
        this.defaultTTL = ttlMs;
    }
    get(key) {
        const item = this.store.get(key);
        if (!item) return null;
        if (Date.now() > item.expiresAt) {
            this.store.delete(key);
            return null;
        }
        return item.value;
    }
    set(key, value, ttl) {
        const expiresAt = Date.now() + (ttl ?? this.defaultTTL);
        this.store.set(key, {
            value,
            expiresAt
        });
    }
    delete(key) {
        this.store.delete(key);
    }
    clear() {
        this.store.clear();
    }
    async fetch(key, fetcher, ttl) {
        const cached = this.get(key);
        if (cached) return cached;
        if (this.flights.has(key)) {
            return this.flights.get(key);
        }
        const promise = (async ()=>{
            try {
                const fresh = await fetcher();
                this.set(key, fresh, ttl);
                return fresh;
            } finally{
                this.flights.delete(key);
            }
        })();
        this.flights.set(key, promise);
        return promise;
    }
}
export const cachedFetch = new Cache();
export default Cache;
