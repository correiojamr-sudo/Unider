const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./load-ts.cjs');
const { handler } = load('supabase/functions/_shared/chat.ts');
const { getRoomMessages, readScript } = load('supabase/functions/get-room-messages/handler.ts');
const room = '00000000-0000-0000-0000-000000000001';
const alice = '00000000-0000-0000-0000-000000000002';
const bob = '00000000-0000-0000-0000-000000000003';
const outsider = '00000000-0000-0000-0000-000000000004';
const message = (id = '00000000-0000-0000-0000-000000000005') => ({ id, sender_id: bob, text: 'Mensagem disponível', timestamp: '2026-10-05T21:30:00.000Z' });
function fixture() {
  const f = { user: alice, active: true, terms: true, banned: false, lock: null, raw: [JSON.stringify(message())], commands: [], authorizations: [], ttl: 173, dedupTtl: 473 };
  f.deps = {
    db: {
      auth: { getUser: async token => { assert.equal(token, 'fixture'); return { data: { user: f.user ? { id: f.user } : null }, error: f.authError ?? null }; } },
      rpc: async (name, args) => {
        assert.equal(name, 'authorize_room'); assert.equal(args.p_operation, 'message'); assert.equal(args.p_user, f.user);
        assert.equal(args.p_room, room); f.authorizations.push(args);
        if (![alice, bob].includes(f.user) || !f.active || !f.terms || f.banned || (f.failSecondAuth && f.authorizations.length === 2)) return { data: null, error: { code: '42501' } };
        return { data: f.roomState ?? { room_id: room, peer_id: f.user === alice ? bob : alice }, error: null };
      },
    },
    redis: async cmd => {
      f.commands.push(cmd);
      if (cmd[0] === 'SET') { if (f.lock) return null; f.lock = cmd[2]; return 'OK'; }
      assert.equal(cmd[0], 'EVAL');
      if (cmd[2] === 1) { if (f.lock === cmd[4]) f.lock = null; return 1; }
      assert.equal(cmd[1], readScript); assert.equal(cmd[2], 2); assert.equal(cmd[4], `room:${room}:messages`);
      if (f.expireLock) f.lock = 'replacement-lock-owner';
      if (f.lock !== cmd[5]) return ['expired'];
      if (f.failRedis) throw new Error('fixture Redis unavailable');
      if (f.readResult !== undefined) return f.readResult;
      return ['ok', f.raw];
    },
    broadcast: () => assert.fail('Reading must never publish'),
  };
  f.read = handler(getRoomMessages, f.deps);
  return f;
}
const req = (body = { roomId: room }, auth = 'Bearer fixture') => new Request('https://example.invalid', { method: 'POST',
  headers: auth ? { Authorization: auth } : {}, body: JSON.stringify(body) });

test('authorized snapshot uses JWT identity, bounded fenced read, reauthorization, and leaves data/TTLs untouched', async () => {
  const f = fixture(); const before = JSON.stringify(f.raw);
  const response = await f.read(req({ roomId: room.toUpperCase(), userId: outsider }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, roomId: room, messages: [message()], partial: true });
  assert.equal(f.authorizations.length, 2); assert.equal(f.authorizations[0].p_user, alice);
  assert.equal(JSON.stringify(f.raw), before); assert.equal(f.ttl, 173); assert.equal(f.dedupTtl, 473); assert.equal(f.lock, null);
  assert.deepEqual([...readScript.matchAll(/redis\.call\('([A-Z]+)'/g)].map(match => match[1]), ['GET', 'LLEN', 'LRANGE']);
  assert.match(readScript, /'LRANGE', KEYS\[2\], 0, 199/);
  assert.deepEqual(f.commands.map(cmd => cmd[0]), ['SET', 'EVAL', 'EVAL']);
});

test('outsider, banned, unconsented and closed rooms cannot read any buffer', async () => {
  for (const failure of ['outsider', 'banned', 'terms', 'closed']) {
    const f = fixture();
    if (failure === 'outsider') f.user = outsider;
    if (failure === 'banned') f.banned = true;
    if (failure === 'terms') f.terms = false;
    if (failure === 'closed') f.active = false;
    const response = await f.read(req({ roomId: room, userId: alice }));
    assert.equal(response.status, 403, failure);
    assert.equal(f.commands.filter(cmd => cmd[0] === 'EVAL' && cmd[2] === 2).length, 0);
    assert.equal(f.lock, null);
  }
  const f = fixture(); f.failSecondAuth = true;
  assert.equal((await f.read(req())).status, 403, 'Access revoked during read cannot return a snapshot');
});

test('history rejects invalid Auth/input and supports only POST/OPTIONS', async () => {
  for (const user of [null, 'invalid-user']) { const f = fixture(); f.user = user; assert.equal((await f.read(req())).status, 401); assert.equal(f.commands.length, 0); }
  const f = fixture();
  assert.equal((await f.read(req({}, ''))).status, 401);
  for (const body of [null, {}, { roomId: 'bad' }, { roomId: 42 }]) assert.equal((await f.read(req(body))).status, 400);
  assert.equal((await f.read(new Request('https://example.invalid', { method: 'POST', headers: { Authorization: 'Bearer fixture' }, body: '{broken' }))).status, 400);
  assert.equal((await f.read(new Request('https://example.invalid'))).status, 405);
  const options = await f.read(new Request('https://example.invalid', { method: 'OPTIONS' }));
  assert.equal(options.status, 200); assert.match(options.headers.get('Access-Control-Allow-Methods'), /POST/);
  assert.equal(f.commands.length, 0);
});

test('empty or expired buffer is a partial snapshot; lock contention/expiry and Redis failure are errors', async () => {
  const empty = fixture(); empty.raw = [];
  const response = await empty.read(req()); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, roomId: room, messages: [], partial: true });
  const busy = fixture(); busy.lock = 'other-owner';
  assert.equal((await busy.read(req())).status, 409); assert.equal(busy.lock, 'other-owner'); assert.equal(busy.authorizations.length, 0);
  const expired = fixture(); expired.expireLock = true;
  assert.equal((await expired.read(req())).status, 409); assert.equal(expired.lock, 'replacement-lock-owner');
  const unavailable = fixture(); unavailable.failRedis = true;
  assert.equal((await unavailable.read(req())).status, 503); assert.equal(unavailable.lock, null);
});

test('malformed snapshots fail closed, never return partial plaintext or treat Redis failure as empty', async () => {
  const cases = [null, {}, ['not-json'], [null], [42], [JSON.stringify({ ...message(), sender_id: outsider })],
    [JSON.stringify({ ...message(), id: 'bad' })], [JSON.stringify({ ...message(), text: '' })],
    [JSON.stringify({ ...message(), text: 'x'.repeat(2001) })], [JSON.stringify({ ...message(), timestamp: '2026-02-30T21:30:00.000Z' })],
    [JSON.stringify(message()), JSON.stringify({ ...message(), text: 'Conflicting ID' })], Array(201).fill(JSON.stringify(message()))];
  for (const raw of cases) {
    const f = fixture(); f.raw = raw;
    const response = await f.read(req()); assert.equal(response.status, 503);
    const body = await response.json(); assert.equal(body.messages, undefined); assert.equal(body.success, undefined);
  }
  for (const result of [null, [], ['ok', null], ['invalid'], { error: 'fixture' }]) {
    const f = fixture(); f.readResult = result; assert.equal((await f.read(req())).status, 503);
  }
  const f = fixture(); f.roomState = { room_id: room, peer_id: outsider + 'bad' };
  assert.equal((await f.read(req())).status, 503);
});

test('two authenticated senders can share a UUID without poisoning the snapshot', async () => {
  const f = fixture();
  const first = message(), second = { ...first, sender_id: alice, text: 'Mesmo UUID, outro autor' };
  f.raw = [JSON.stringify(first), JSON.stringify(second), JSON.stringify(first)];
  const response = await f.read(req());
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).messages, [first, second, first]);
  f.raw.push(JSON.stringify({ ...second, text: 'Contradição do mesmo autor' }));
  assert.equal((await f.read(req())).status, 503);
});
