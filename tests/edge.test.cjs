const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./load-ts.cjs');
const { handler, dependencies } = load('supabase/functions/_shared/chat.ts');
const { sendMessage } = load('supabase/functions/send-message/handler.ts');
const { reportRoom } = load('supabase/functions/report-room/handler.ts');
const { getRoomMessages } = load('supabase/functions/get-room-messages/handler.ts');
const { mergeChatMessages, readHistorySnapshot } = load('src/lib/chatHistory.ts');
const room = '00000000-0000-0000-0000-000000000001';
const id = '00000000-0000-0000-0000-000000000002';
const alice = '00000000-0000-0000-0000-00000000000a', bob = '00000000-0000-0000-0000-00000000000b';
function fixture() {
  const f = { user: alice, allowed: true, insertFails: false, broadcastFails: false,
    lock: null, closed: false, list: [], dedup: new Map(), reports: new Map(), broadcasts: [], writes: 0 };
  f.deps = {
    db: {
      auth: { getUser: async () => ({ data: { user: f.user ? { id: f.user } : null }, error: null }) },
      rpc: async (name, args) => {
        assert.equal(args.p_user, f.user);
        if (name === 'persist_room_report') {
          if (f.insertFails) return { error: {} };
          const key = args.p_room + ':' + args.p_user;
          if (!f.reports.has(key)) f.reports.set(key, { reported_id: f.user === alice ? bob : alice, transcript: args.p_transcript });
          return { data: 'report-id', error: null };
        }
        assert.equal(name, 'authorize_room');
        if (!f.allowed || ![alice, bob].includes(f.user) || (f.closed && args.p_operation === 'message')) return { error: {}, data: null };
        if (args.p_operation === 'report') f.closed = true;
        return { data: { room_id: room, peer_id: f.user === alice ? bob : alice }, error: null };
      },
    },
    redis: async cmd => {
      if (cmd[0] === 'SET') {
        if (f.lock) return null;
        f.lock = cmd[2]; return 'OK';
      }
      if (cmd[0] === 'LRANGE') return [...f.list];
      assert.equal(cmd[0], 'EVAL');
      if (cmd[2] === 1) {
        if (f.lock === cmd[4]) f.lock = null;
        return 1;
      }
      if (cmd[2] === 2) return f.lock === cmd[5] ? ['ok', [...f.list]] : ['expired'];
      if (f.lock !== cmd[6]) return ['expired'];
      const old = f.dedup.get(cmd[7]);
      if (old) return ['ok', old];
      if (f.dedup.size >= 200) return ['quota'];
      f.dedup.set(cmd[7], cmd[8]); f.list.push(cmd[9]); f.writes++;
      return ['ok', cmd[8]];
    },
    broadcast: async (topic, message) => {
      assert.equal(topic, room);
      if (f.broadcastFails) throw new Error('offline');
      f.broadcasts.push(message);
    },
  };
  f.send = handler(sendMessage, f.deps); f.report = handler(reportRoom, f.deps); f.read = handler(getRoomMessages, f.deps);
  return f;
}
function req(body, authorization = 'Bearer fixture') {
  return new Request('https://example.invalid', { method: 'POST', headers: authorization ? { Authorization: authorization } : {}, body: JSON.stringify(body) });
}
const body = () => ({ roomId: room, message: { id, text: 'Olá', timestamp: 'forged time' } });
test('member positive control: server identity/time, buffer before delivery', async () => {
  const f = fixture(), response = await f.send(req(body()));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.message.sender_id, alice);
  assert.notEqual(result.message.timestamp, 'forged time');
  assert.equal(f.list.length, 1); assert.equal(f.broadcasts.length, 1);
});
test('outsider send/report and denied profiles fail before reading/writing evidence', async () => {
  for (const action of ['send', 'report']) for (const kind of ['outsider', 'banned/unconsented/deleted']) {
    const f = fixture();
    if (kind === 'outsider') f.user = 'outsider'; else f.allowed = false;
    const response = await f[action](req(action === 'send' ? body() : { roomId: room }));
    assert.equal(response.status, 403); assert.equal(f.writes, 0); assert.equal(f.reports.size, 0);
  }
});
test('missing token, forged identity, invalid payload and HTTP methods rejected', async () => {
  const f = fixture();
  assert.equal((await f.send(req(body(), ''))).status, 401);
  assert.equal((await f.send(req({ ...body(), message: { ...body().message, sender_id: bob } }))).status, 400);
  for (const message of [{ id, text: '' }, { id, text: 'x'.repeat(2001) }, { id: 'bad', text: 'hello' }]) {
    assert.equal((await f.send(req({ roomId: room, message }))).status, 400);
  }
  assert.equal((await f.send(new Request('https://example.invalid'))).status, 405);
  assert.equal((await f.send(new Request('https://example.invalid', { method: 'OPTIONS' }))).status, 200);
  assert.equal(f.writes, 0);
});
test('delivery failure stays retryable and exact retry appends once', async () => {
  const f = fixture(); f.broadcastFails = true;
  assert.equal((await f.send(req(body()))).status, 503);
  f.broadcastFails = false;
  assert.equal((await f.send(req(body()))).status, 200);
  assert.equal(f.list.length, 1);
  assert.equal((await f.send(req({ ...body(), message: { id, text: 'altered' } }))).status, 409);
});

test('same UUID across participants survives send, snapshot and client merge; each sender retry stays idempotent', async () => {
  const f = fixture();
  assert.equal((await f.send(req(body()))).status, 200);
  f.user = bob;
  const second = { roomId: room, message: { id, text: 'Outro participante, mesmo UUID' } };
  assert.equal((await f.send(req(second))).status, 200);
  assert.equal((await f.send(req(second))).status, 200);
  assert.equal(f.list.length, 2);
  const response = await f.read(req({ roomId: room }));
  assert.equal(response.status, 200);
  const snapshot = readHistorySnapshot(await response.json(), room, alice, bob);
  assert.equal(mergeChatMessages(f.broadcasts, snapshot).length, 2);
  assert.equal((await f.send(req({ roomId: room, message: { id, text: 'Mudança do mesmo remetente' } }))).status, 409);
});
test('failed report preserves evidence, retry and second reporter retain it', async () => {
  const f = fixture();
  await f.send(req(body())); f.insertFails = true;
  assert.equal((await f.report(req({ roomId: room, reportedId: 'fabricated' }))).status, 503);
  assert.equal(f.list.length, 1);
  assert.equal((await f.send(req(body()))).status, 403);
  f.insertFails = false;
  assert.equal((await f.report(req({ roomId: room, reportedId: 'fabricated' }))).status, 200);
  assert.equal((await f.report(req({ roomId: room }))).status, 200);
  assert.equal(f.reports.size, 1);
  const saved = [...f.reports.values()][0];
  assert.equal(saved.reported_id, bob);
  assert.equal(saved.transcript[0].sender, 'reporter');
  assert.equal(saved.transcript[0].sender_id, undefined);
  f.user = bob;
  assert.equal((await f.report(req({ roomId: room }))).status, 200);
  assert.equal(f.reports.size, 2); assert.equal(f.list.length, 1);
});
test('room lock rejects overlapping request rather than splitting the snapshot', async () => {
  const f = fixture(); f.lock = 'other owner';
  assert.equal((await f.send(req(body()))).status, 409);
  assert.equal((await f.report(req({ roomId: room }))).status, 409);
  assert.equal(f.lock, 'other owner');
});
test('buffer TTL does not reset room quota/dedup; metadata stores no plaintext', async () => {
  const f = fixture();
  await f.send(req(body()));
  assert.equal(JSON.parse([...f.dedup.values()][0]).text, undefined);
  f.list = []; // Represents transcript TTL eviction, not dedup metadata eviction.
  assert.equal((await f.send(req(body()))).status, 200);
  assert.equal(f.list.length, 0);
  while (f.dedup.size < 200) f.dedup.set('fixture-' + f.dedup.size, '{}');
  assert.equal((await f.send(req({ roomId: room, message: { id: '00000000-0000-0000-0000-000000000003', text: 'next' } }))).status, 429);
});
test('REST publisher explicitly marks room broadcasts private and checks failure', async () => {
  const source = require('node:fs').readFileSync('supabase/functions/_shared/chat.ts', 'utf8');
  assert.match(source, /private: true/);
  assert.match(source, /if \(!response.ok\) throw new HttpError\(503, 'Delivery/);
  assert.equal(typeof dependencies, 'function');
});
