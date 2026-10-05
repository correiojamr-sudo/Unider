const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./load-ts.cjs');
const { classifyChatError, reportIssueText, sameChatContext } = load('src/lib/chatRecovery.ts');
const { runChatOperation } = load('src/lib/chatOperations.ts');
const { isRoomState } = load('src/lib/chatSession.ts');

test('recovery uses codes/status, never ambiguous error text as proof of room closure', () => {
  assert.equal(classifyChatError({ code: '42501' }).kind, 'denied');
  assert.equal(classifyChatError({ code: 'PGRST301' }).kind, 'denied');
  for (const status of [401, 403, 404, 410]) assert.equal(classifyChatError({ context: { status } }).kind, 'denied');
  for (const status of [408, 409, 429, 500, 503]) assert.equal(classifyChatError({}, status).kind, 'transient');
  for (const code of ['08006', '40001', '40P01', '57014']) assert.equal(classifyChatError({ code }).kind, 'transient');
  assert.equal(classifyChatError(new TypeError('offline')).kind, 'transient');
  assert.equal(classifyChatError({ name: 'FunctionsFetchError' }).kind, 'transient');
  assert.equal(classifyChatError({ name: 'TimeoutError' }).kind, 'transient');
  assert.equal(classifyChatError({ message: 'Room unavailable' }).kind, 'unknown');
  assert.equal(classifyChatError({ code: 'UNCONFIRMED_RESPONSE' }).kind, 'unknown');
});

test('report errors before authorization, lock and persistence do not claim suspension', () => {
  for (const status of [401, 403, 409, 503]) {
    const text = reportIssueText(classifyChatError({ context: { status } }));
    assert.ok(text.startsWith('Denúncia não confirmada'));
    assert.ok(!text.includes('A conversa foi suspensa'));
  }
});

test('room confirmation rejects malformed payloads and a response for another room', () => {
  const room = { status: 'matched', room_id: 'a', peer_id: 'bob',
    expires_at: '2026-10-05T21:32:00Z', hard_close_at: '2026-10-05T21:50:00Z',
    decision_until: '2026-10-05T21:32:30Z', ended_at: null, end_reason: null,
    extended_once: false, extended: false, peer_extended: false, server_now: '2026-10-05T21:30:00Z' };
  assert.equal(isRoomState(room, 'a'), true);
  assert.equal(isRoomState(room, 'b'), false);
  assert.equal(isRoomState({ ...room, server_now: 'invalid' }, 'a'), false);
  assert.equal(isRoomState({ ...room, extended: 'yes' }, 'a'), false);
  assert.equal(isRoomState({ status: 'matched', room_id: 'a' }), false);
});

test('context guard rejects room, owner, session and same-ID replacement changes', () => {
  const context = { ownerId: 'alice', roomId: 'a', contextVersion: 2 };
  assert.equal(sameChatContext(context, context, 'alice'), true);
  assert.equal(sameChatContext(context, { ...context, roomId: 'b' }, 'alice'), false);
  assert.equal(sameChatContext(context, { ...context, ownerId: 'bob' }, 'bob'), false);
  assert.equal(sameChatContext(context, context, undefined), false);
  assert.equal(sameChatContext(context, { ...context, contextVersion: 3 }, 'alice'), false);
});

test('confirmed operations run effects only in the current context and always release loading there', async () => {
  const seen = [];
  await runChatOperation({ request: () => Promise.resolve({ success: true }), current: () => true,
    confirmed: result => seen.push(result.success), failed: () => seen.push('failed'), settled: () => seen.push('settled') });
  assert.deepEqual(seen, [true, 'settled']);
  seen.length = 0;
  await runChatOperation({ request: () => Promise.resolve({ error: { code: '42501' } }), current: () => true,
    confirmed: result => { throw result.error; }, failed: error => seen.push(error.code), settled: () => seen.push('settled') });
  assert.deepEqual(seen, ['42501', 'settled']);
});

test('late success or failure cannot clear, navigate or settle a new context', async () => {
  for (const failure of [false, true]) {
    let active = true;
    let finish;
    const effects = [];
    const operation = runChatOperation({ request: () => new Promise((resolve, reject) => { finish = failure ? reject : resolve; }),
      current: () => active, confirmed: () => effects.push('clear/navigate'), failed: () => effects.push('error'), settled: () => effects.push('loading') });
    active = false;
    finish(failure ? new TypeError('offline') : { success: true });
    await operation;
    assert.deepEqual(effects, []);
  }
});
