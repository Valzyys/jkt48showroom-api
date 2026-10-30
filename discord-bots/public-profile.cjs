/** Public application description and supported bot presence; no member-list fetches. */
const BOT_ID = '1305141693477027891';
const INTERVAL = 10 * 60_000;
const MIN_REFRESH = 60_000;
const format = value => value.toLocaleString('id-ID');
const STATS_BLOCK = /\n\n📊 Statistik bot\n[^\n]*\nAkumulasi lintas server, termasuk bot\./g;

function descriptionWithStats(description, stats) {
  const base = String(description || '').replace(STATS_BLOCK, '').trimEnd();
  const result = `${base}\n\n📊 Statistik bot\n${format(stats.servers)} server · ≈${format(stats.members)} total member\nAkumulasi lintas server, termasuk bot.`;
  if (result.length > 400) throw Object.assign(Error('Description has no room for statistics'), { code: 'description_too_long' });
  return result;
}

async function fetchStats(rest) {
  const guilds = new Map();
  let after;
  for (;;) {
    const query = new URLSearchParams({ limit: '200', with_counts: 'true', ...(after ? { after } : {}) });
    const page = await rest.get('/users/@me/guilds', { query });
    if (!Array.isArray(page)) throw Object.assign(Error('Invalid guild response'), { code: 'invalid_guild_counts' });
    for (const guild of page) {
      if (!guild.id || !Number.isSafeInteger(guild.approximate_member_count) || guild.approximate_member_count < 0) {
        throw Object.assign(Error('Incomplete guild count'), { code: 'incomplete_guild_counts' });
      }
      guilds.set(guild.id, guild.approximate_member_count);
    }
    if (page.length < 200) break;
    const next = page[page.length - 1].id;
    if (next === after) throw Object.assign(Error('Guild pagination did not advance'), { code: 'invalid_guild_pagination' });
    after = next;
  }
  return { servers: guilds.size, members: [...guilds.values()].reduce((sum, count) => sum + count, 0) };
}

function install(client, { store, monitoring, flush = () => {}, now = Date.now } = {}) {
  const state = { status: 'waiting', interval_seconds: INTERVAL / 1000, member_count_is_approximate: true, member_count_is_unique: false, presence_images_supported: false };
  if (monitoring) monitoring.public_profile = state;
  let running = false, lastAttempt = null, wakeTimer, stopped = false;

  async function refresh() {
    if (stopped || running || !client.isReady()) return;
    if (lastAttempt !== null && now() - lastAttempt < MIN_REFRESH) return;
    running = true;
    lastAttempt = now();
    try {
      if (client.user.id !== BOT_ID) throw Object.assign(Error('Wrong bot identity'), { code: 'wrong_bot_identity' });
      const stats = await fetchStats(client.rest);
      const app = await client.rest.get('/applications/@me');
      if (app.id !== BOT_ID) throw Object.assign(Error('Wrong application identity'), { code: 'wrong_bot_identity' });
      const description = descriptionWithStats(app.description, stats);
      if (app.description !== description) {
        if (store && !store.get('public-profile:original')) store.set('public-profile:original', { description: app.description, saved_at: now() });
        // Only change description: installation settings, avatar and banner stay untouched.
        await client.rest.patch('/applications/@me', { body: { description } });
      }
      const name = `${format(stats.servers)} server · ≈${format(stats.members)} member | /help`;
      if (state.presence !== name) client.user.setPresence({ status: 'online', activities: [{ type: 3, name }] });
      Object.assign(state, stats, { status: 'ok', presence: name, last_success: now(), error: null });
      console.log(`public-profile-updated servers=${stats.servers} members=${stats.members}`);
    } catch (error) {
      state.status = 'error';
      state.error = String(error.code || error.status || error.name || 'profile_failed');
      console.warn('public-profile-update-failed code=' + state.error);
    } finally {
      running = false;
      flush();
    }
  }

  function schedule() {
    clearTimeout(wakeTimer);
    const delay = Math.max(5000, MIN_REFRESH - (now() - (lastAttempt ?? 0)));
    wakeTimer = setTimeout(() => void refresh(), delay);
    wakeTimer.unref();
  }
  const timer = setInterval(() => void refresh(), INTERVAL);
  timer.unref();
  client.once('clientReady', () => void refresh());
  client.on('guildCreate', schedule);
  client.on('guildDelete', schedule);
  return { state, refresh, stop() { stopped = true; clearInterval(timer); clearTimeout(wakeTimer); client.off('guildCreate', schedule); client.off('guildDelete', schedule); } };
}

module.exports = { install, fetchStats, descriptionWithStats };
