import { binding, env, background } from '@/runtime/env';
class CacheManager {
  key(key) { return `${env.NODE_ENV === 'development' ? 'DEV' : 'GROUP'}:${key}`; }
  async get(key) {
    const row = await binding('DB').prepare('SELECT value FROM cache_entries WHERE key=? AND expires_at>?').bind(this.key(key), Date.now()).first();
    return row ? JSON.parse(row.value) : null;
  }
  async set(key, value, milliseconds = 3600000) {
    await binding('DB').prepare('INSERT INTO cache_entries(key,value,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires_at=excluded.expires_at').bind(this.key(key), JSON.stringify(value), Date.now() + milliseconds).run();
  }
  async fetch(key, fetcher, milliseconds = 3600000) {
    const cached = await this.get(key);
    if (cached !== null) return cached;
    const value = await fetcher();
    await this.set(key, value, milliseconds);
    return value;
  }
  async delete(key) { await binding('DB').prepare('DELETE FROM cache_entries WHERE key=?').bind(this.key(key)).run(); }
  async clear() { await binding('DB').prepare('DELETE FROM cache_entries').run(); }
}
export default new CacheManager();
