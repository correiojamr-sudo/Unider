const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./load-ts.cjs');
const source = require('node:fs').readFileSync('src/lib/chatHistory.ts', 'utf8');
const compiled = require('typescript').transpileModule(source, { compilerOptions: { module: 1, target: 9 } });
const historyModule = { exports: {} };
require('node:vm').runInThisContext('(function(module, exports, require) {\n' + compiled.outputText + '\n})')(
  historyModule, historyModule.exports, () => load('src/lib/chatRecovery.ts'));
const { createChatHistoryRecovery, mergeChatMessages, readHistorySnapshot } = historyModule.exports;
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const message = (n, seconds = n) => ({ id: id(n), sender_id: 'bob', text: `Mensagem ${n}`, timestamp: `2026-10-05T21:30:${String(seconds).padStart(2, '0')}.000Z` });
const reply = messages => ({ data: { success: true, roomId: 'room-a', partial: true, messages }, error: null });
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
function recovery() {
  const f = { current: true, messages: [message(1)], states: [], calls: [], replies: [] };
  f.machine = createChatHistoryRecovery({ roomId: 'room-a', userId: 'alice', peerId: 'bob', current: () => f.current,
    request: signal => { f.calls.push(signal); const next = f.replies.shift(); return next ?? Promise.resolve(reply([])); },
    merge: incoming => { f.messages = mergeChatMessages(f.messages, incoming); }, state: state => f.states.push(state) });
  return f;
}

test('snapshot plus broadcasts merge without loss/duplicates and order independently of arrival', async () => {
  const f = recovery(), pending = deferred(); f.replies.push(pending.promise);
  const work = f.machine.status(true);
  // Snapshot is pending while a new broadcast and an overlapping broadcast arrive.
  f.messages = mergeChatMessages(f.messages, [message(4), message(3)]);
  pending.resolve(reply([message(2), message(3)])); await work;
  assert.deepEqual(f.messages.map(m => m.id), [1,2,3,4].map(id));
  assert.equal(f.states.at(-1).status, 'partial');
  const before = f.messages.slice();
  f.messages = mergeChatMessages(f.messages, [message(2)]); assert.deepEqual(f.messages, before);
  assert.deepEqual(mergeChatMessages([message(2, 1)], [message(1, 1)]).map(m => m.id), [id(1),id(2)]);
  assert.equal(mergeChatMessages([message(1)], [{ ...message(1), text: 'Old snapshot conflict' }])[0].text, 'Mensagem 1');
});

test('only SUBSCRIBED transitions/manual retry read; reconnect fences old reads and keeps known messages', async () => {
  const f = recovery(); await f.machine.retry(); assert.equal(f.calls.length, 0);
  const pending = deferred(); f.replies.push(pending.promise);
  const old = f.machine.status(true); await f.machine.status(true); await f.machine.retry();
  assert.equal(f.calls.length, 1);
  f.machine.status(false); assert.equal(f.calls[0].aborted, true);
  f.replies.push(Promise.resolve(reply([message(2)]))); await f.machine.status(true);
  pending.resolve(reply([message(5)])); await old;
  assert.deepEqual(f.messages.map(m => m.id), [id(1),id(2)]); assert.equal(f.calls.length, 2);
});

test('history errors preserve messages and allow manual retry without hiding denial/empty partial snapshot', async () => {
  for (const failure of ['throw', 'busy', 'denied', 'malformed']) {
    const f = recovery();
    f.replies.push(failure === 'throw' ? Promise.reject(new TypeError('offline')) : Promise.resolve(failure === 'malformed'
      ? { data: { success: true, roomId: 'room-a', messages: [] }, error: null }
      : { data: null, error: { context: { status: failure === 'busy' ? 409 : 403 } } }));
    await f.machine.status(true); assert.deepEqual(f.messages.map(m => m.id), [id(1)]);
    assert.equal(f.states.at(-1).status, failure === 'denied' ? 'unavailable' : 'error');
    assert.equal(f.calls.length, 1);
    await f.machine.retry(); assert.equal(f.states.at(-1).status, 'partial');
    assert.deepEqual(f.messages.map(m => m.id), [id(1)]);
  }
});

test('late snapshot success/error after stop or context switch cannot merge, navigate or settle a new context', async () => {
  for (const failure of [false, true]) for (const end of ['stop','context']) {
    const f = recovery(), pending = deferred(); f.replies.push(pending.promise);
    const work = f.machine.status(true);
    if (end === 'stop') f.machine.stop(); else f.current = false;
    const states = f.states.length; f.messages = [message(9)];
    if (failure) pending.reject(new Error('old')); else pending.resolve(reply([message(2)]));
    await work; assert.deepEqual(f.messages.map(m => m.id), [id(9)]); assert.equal(f.states.length, states);
  }
});

test('client rejects malformed history and conflicting IDs before merging', () => {
  const base = reply([message(1)]).data;
  for (const data of [null, {}, { ...base, partial: false }, { ...base, roomId: 'other' }, { ...base, messages: null },
    { ...base, messages: [{ ...message(1), sender_id: 'outsider' }] }, { ...base, messages: [{ ...message(1), timestamp: 'invalid' }] },
    { ...base, messages: [message(1), { ...message(1), text: 'conflict' }] }, { ...base, messages: Array(201).fill(message(1)) }]) {
    assert.throws(() => readHistorySnapshot(data, 'room-a', 'alice', 'bob'));
  }
});
