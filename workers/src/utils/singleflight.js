export class SingleFlight {
    inflight = new Map();
    async do(key, fn) {
        if (this.inflight.has(key)) {
            return this.inflight.get(key);
        }
        const p = (async ()=>{
            try {
                const result = await fn();
                return result;
            } finally{
                this.inflight.delete(key);
            }
        })();
        this.inflight.set(key, p);
        return p;
    }
    has(key) {
        return this.inflight.has(key);
    }
    clear(key) {
        if (key) this.inflight.delete(key);
        else this.inflight.clear();
    }
}
export default new SingleFlight();
