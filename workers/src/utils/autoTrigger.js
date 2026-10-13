export class AutoTrigger {
    fn;
    intervalMs;
    lastCall = 0;
    timer;
    constructor(fn, intervalMs){
        this.fn = fn;
        this.intervalMs = intervalMs;
    }
    touch() {
        this.lastCall = Date.now();
    }
    start(...args) {
        this.lastCall = Date.now();
        this.timer = setInterval(async ()=>{
            const now = Date.now();
            if (now - this.lastCall > this.intervalMs) {
                console.log(`[AutoTrigger] Inactive for ${this.intervalMs / 1000}s, calling function...`);
                await this.fn(...args);
                this.lastCall = now;
            }
        }, this.intervalMs);
        return this;
    }
    stop() {
        if (this.timer) clearInterval(this.timer);
    }
}
