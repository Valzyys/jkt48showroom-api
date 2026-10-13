function setValue(value, ms) {
    return {
        value,
        expireIn: ms,
        date: new Date().getTime()
    };
}
class LocalCacheManager {
    map;
    constructor(){
        this.map = new Map();
    }
    set(key, value, ms = 3600000) {
        if (!key) throw new Error('No Key');
        this.map.set(key, setValue(value, ms));
    }
    get(key) {
        return this.map.get(key)?.value;
    }
    delete(key) {
        return this.map.delete(key);
    }
    clear() {
        this.map.clear();
    }
    has(key) {
        return this.map.has(key);
    }
    valid(key) {
        if (!this.map.has(key)) return false;
        const d = this.map.get(key);
        if (new Date().getTime() - new Date(d?.date ?? 0).getTime() < (d?.expireIn ?? 0)) {
            return true;
        }
        return false;
    }
}
export default LocalCacheManager;
