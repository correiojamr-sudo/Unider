const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./load-ts.cjs');
const { clockSample, confirmedClock, requestClock, CLOCK_FRESH_MS } = load('src/lib/serverClock.ts');
const { getModeFromTime } = load('src/lib/lobbySchedule.ts');
const { canJoinLobbyQueue, shouldEnterChat } = load('src/lib/lobbyQueue.ts');
const { getLisbonDay } = load('src/utils/time.ts');
const queue = { ownerId: 'alice', roomId: null, isQueueing: true, queueDay: '2026-10-05' };
test('server clock bounds RTT/ISO/freshness/context and ignores skewed device day', () => {
  const sample = clockSample('2026-10-05T21:29:59.000Z', 'alice', 7, 0, 200);
  assert.equal(sample.rtt, 200);
  assert.equal(confirmedClock(sample, 'alice', 7, 1100).toISOString(), '2026-10-05T21:30:00.000Z');
  for (const [user, revision, elapsed] of [['bob', 7, 200], ['alice', 8, 200], ['alice', 7, 199], ['alice', 7, 200 + CLOCK_FRESH_MS]]) assert.equal(confirmedClock(sample, user, revision, elapsed), null);
  for (const value of ['invalid', '2026-02-30T21:30:00.000Z', '2026-10-05T21:30:00Z', null]) assert.equal(clockSample(value, 'alice', 7, 0, 20), null);
  for (const end of [-1, 5001, NaN]) assert.equal(clockSample('2026-10-05T21:30:00.000Z', 'alice', 7, 0, end), null);
  const original = Date.now;
  try {
    Date.now = () => Date.parse('2026-10-07T08:00:00Z');
    const now = confirmedClock(sample, 'alice', 7, 1100);
    assert.equal(getLisbonDay(now), '2026-10-05');
    assert.equal(shouldEnterChat(queue, 'alice', true, now), true);
  } finally { Date.now = original; }
});
test('confirmed server sample drives 22:28/22:30/22:48/22:50 and winter/summer queue gates', () => {
  for (const [day, hour] of [['2026-10-05', '21'], ['2026-01-05', '22']]) {
    for (const [time, mode, join, enter] of [['27:59', 'DAYTIME', false, false], ['28:00', 'QUEUE', true, false], ['29:59', 'QUEUE', true, false], ['30:00', 'ACTIVE', true, true], ['47:59', 'ACTIVE', true, true], ['48:00', 'CLOSING', false, false], ['49:59', 'CLOSING', false, false], ['50:00', 'DAYTIME', false, false]]) {
      const sample = clockSample(`${day}T${hour}:${time}.000Z`, 'alice', 1, 0, 0);
      const now = confirmedClock(sample, 'alice', 1, 0);
      assert.equal(getModeFromTime(now), mode);
      assert.equal(canJoinLobbyQueue(queue, 'alice', true, now), join);
      assert.equal(shouldEnterChat({ ...queue, queueDay: day }, 'alice', true, now), enter);
    }
  }
});
test('clock failure, malformed response and obsolete success/rejection cannot confirm new context', async () => {
  for (const kind of ['error', 'throw', 'invalid', 'obsolete-success', 'obsolete-error']) {
    let resolve, reject, current = true, accepted = 0, failed = 0;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    const work = requestClock({ request: () => promise, current: () => current, elapsed: () => 100, userId: 'alice', revision: 1,
      confirmed: () => accepted++, failed: () => failed++ });
    if (kind.startsWith('obsolete')) current = false;
    if (kind.endsWith('error') || kind === 'throw') reject(new Error('offline'));
    else resolve({ data: { server_now: kind === 'invalid' ? 'invalid' : '2026-10-05T21:30:00.000Z' }, error: kind === 'error' ? {} : null });
    await work; assert.equal(accepted, 0); assert.equal(failed, kind.startsWith('obsolete') ? 0 : 1);
  }
});
test('get-server-time checks JWT with getUser and returns only canonical ISO, without mutations', async () => {
  const { handler } = load('supabase/functions/_shared/chat.ts');
  const { getServerTime } = load('supabase/functions/get-server-time/handler.ts');
  let user = '00000000-0000-0000-0000-000000000001', error = null, reads = 0;
  const deps = { db: { auth: { getUser: async token => { reads++; assert.equal(token, 'fixture'); return { data: { user: user ? { id: user } : null }, error }; } }, rpc: () => assert.fail('SQL forbidden') }, redis: () => assert.fail('Redis forbidden'), broadcast: () => assert.fail('broadcast forbidden') };
  const request = handler(getServerTime, deps);
  const req = auth => new Request('https://fixture.invalid', { method: 'POST', headers: auth ? { Authorization: auth } : {}, body: '{}' });
  const response = await request(req('Bearer fixture'));
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store'); const data = await response.json();
  assert.deepEqual(Object.keys(data), ['server_now']); assert.equal(new Date(data.server_now).toISOString(), data.server_now);
  for (const value of [null, 'invalid']) { user = value; assert.equal((await request(req('Bearer fixture'))).status, 401); }
  user = '00000000-0000-0000-0000-000000000001'; error = {};
  assert.equal((await request(req('Bearer fixture'))).status, 401);
  const before = reads;
  for (const value of [null, 'Basic fixture', 'Bearer a b']) assert.equal((await request(req(value))).status, 401);
  assert.equal((await request(new Request('https://fixture.invalid'))).status, 405);
  assert.equal((await request(new Request('https://fixture.invalid', { method: 'OPTIONS' }))).status, 200);
  assert.equal(reads, before);
});
