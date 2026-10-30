const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { fetchStats, descriptionWithStats, install } = require('../public-profile.cjs');
const ID = '1305141693477027891';

test('description preserves existing copy, replaces its own statistics and stays within Discord limit', () => {
  const base = 'JKT48Connect\n\nExisting links and attribution.';
  const first = descriptionWithStats(base, { servers: 94, members: 26519 });
  const next = descriptionWithStats(first, { servers: 95, members: 28000 });
  assert.ok(next.startsWith(base));
  assert.ok(next.includes('95 server · ≈28.000 total member'));
  assert.equal(next.split('📊 Statistik bot').length, 2);
  assert.throws(() => descriptionWithStats('x'.repeat(400), { servers: 1, members: 2 }), { code: 'description_too_long' });
});

test('member totals paginate without fetching member identities; incomplete counts never publish as zero', async () => {
  const first = Array.from({ length: 200 }, (_, i) => ({ id: String(i + 1), approximate_member_count: 10 }));
  const calls = [];
  const result = await fetchStats({ async get(route, { query }) {
    calls.push([route, query.get('after'), query.get('with_counts')]);
    return calls.length === 1 ? first : [{ id: '201', approximate_member_count: 5 }];
  } });
  assert.deepEqual(result, { servers: 201, members: 2005 });
  assert.deepEqual(calls, [['/users/@me/guilds', null, 'true'], ['/users/@me/guilds', '200', 'true']]);
  await assert.rejects(fetchStats({ get: async () => [{ id: '1' }] }), { code: 'incomplete_guild_counts' });
});

test('updates only description and supported presence fields, throttles calls and backs up the original', async () => {
  let time = 100000, description = 'Original description';
  const edits = [], presence = [], saved = new Map();
  const client = Object.assign(new EventEmitter(), {
    isReady: () => true,
    user: { id: ID, setPresence: value => presence.push(value) },
    rest: {
      get: async route => route === '/applications/@me' ? { id: ID, description } : [{ id: '1', approximate_member_count: 30 }],
      patch: async (route, { body }) => { edits.push({ route, body }); description = body.description; },
    },
  });
  const monitoring = {};
  const worker = install(client, { monitoring, now: () => time, store: { get: key => saved.get(key), set: (key, value) => saved.set(key, value) } });
  try {
    await Promise.all([worker.refresh(), worker.refresh()]);
    assert.equal(edits.length, 1);
    assert.deepEqual(Object.keys(edits[0].body), ['description']);
    assert.deepEqual(presence[0], { status: 'online', activities: [{ type: 3, name: '1 server · ≈30 member | /help' }] });
    assert.equal(saved.get('public-profile:original').description, 'Original description');
    time += 60000;
    await worker.refresh();
    assert.equal(edits.length, 1);
    assert.equal(presence.length, 1);
    assert.equal(monitoring.public_profile.status, 'ok');
  } finally { worker.stop(); }
});
