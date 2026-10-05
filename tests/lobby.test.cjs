const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { fromZonedTime } = require('date-fns-tz');
const { load } = require('./load-ts.cjs');
const { lobbySchedule, getModeFromTime } = load('src/lib/lobbySchedule.ts');
const { getSecondsUntil, formatTimeCountdown } = load('src/utils/time.ts');
const { canJoinLobbyQueue, hasLobbyQueueIntent, shouldEnterChat } = load('src/lib/lobbyQueue.ts');
const { saveLobbySuggestion } = load('src/lib/lobbySuggestion.ts');
const lisbon = (clock, day = '2026-10-05') => fromZonedTime(`${day}T${clock}`, 'Europe/Lisbon');

// Fresh VM per reload, with the actual Zustand persist middleware and storage.
function reloadStore(storage) {
  const filename = path.resolve('src/store/chatStore.ts');
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, sessionStorage: storage, Date,
    require: name => name.startsWith('.') ? load(path.resolve(path.dirname(filename), name)) : require(name),
  });
  return module.exports.useChatStore;
}
function storageFixture() {
  const entries = new Map();
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
}

test('Lisbon lobby boundaries and countdown events in summer and winter', () => {
  const cases = [
    ['22:27:59', 'DAYTIME', '22:28:00', 1],
    ['22:28:00', 'QUEUE', '22:30:00', 120],
    ['22:29:59', 'QUEUE', '22:30:00', 1],
    ['22:30:00', 'ACTIVE', '22:48:00', 1080],
    ['22:35:00', 'ACTIVE', '22:48:00', 780],
    ['22:47:59', 'ACTIVE', '22:48:00', 1],
    ['22:48:00', 'CLOSING', '22:50:00', 120],
    ['22:49:59', 'CLOSING', '22:50:00', 1],
    ['22:50:00', 'DAYTIME', '22:28:00', 85080],
  ];
  for (const day of ['2026-07-05', '2026-12-05']) for (const [clock, mode, target, seconds] of cases) {
    const now = lisbon(clock, day);
    const view = lobbySchedule(now);
    assert.equal(getModeFromTime(now), mode, `${day} ${clock}`);
    assert.equal(view.target, target);
    assert.equal(view.countdown, seconds);
    assert.ok(view.title.includes(target.slice(0, 5).replace(':', 'h')));
  }
  assert.equal(formatTimeCountdown(lobbySchedule(lisbon('22:35:00')).countdown), '13:00');
});

test('next-day countdown accounts for both Lisbon daylight-saving changes', () => {
  assert.equal(getSecondsUntil('22:28:00', lisbon('23:00:00', '2026-03-28')), 22 * 3600 + 28 * 60);
  assert.equal(getSecondsUntil('22:28:00', lisbon('23:00:00', '2026-10-24')), 24 * 3600 + 28 * 60);
  assert.equal(getSecondsUntil('22:30:00', lisbon('22:35:00'), false), 0);
});

test('real persisted store preserves pre-queue on refresh and cancel survives reload', () => {
  const storage = storageFixture();
  let store = reloadStore(storage);
  store.getState().setOwner('alice');
  store.getState().setQueueing(true, lisbon('22:28:00'));
  store = reloadStore(storage);
  assert.equal(store.persist.hasHydrated(), true);
  store.getState().setOwner('alice'); // Session restored for the same owner.
  assert.equal(hasLobbyQueueIntent(store.getState(), 'alice', lisbon('22:29:59')), true);
  assert.equal(shouldEnterChat(store.getState(), 'alice', true, lisbon('22:29:59')), false);
  assert.equal(shouldEnterChat(store.getState(), 'alice', true, lisbon('22:30:00')), true);
  store.getState().setQueueing(false);
  store = reloadStore(storage);
  assert.equal(store.getState().queueDay, null);
  assert.equal(shouldEnterChat(store.getState(), 'alice', true, lisbon('22:30:00')), false);
});

test('queue gates terms, ownership, day and cutoff without granting server authority', () => {
  const state = { ownerId: 'alice', roomId: null, isQueueing: true, queueDay: '2026-10-05' };
  for (const clock of ['22:27:59', '22:48:00', '22:49:59', '22:50:00']) {
    assert.equal(canJoinLobbyQueue(state, 'alice', true, lisbon(clock)), false);
    assert.equal(shouldEnterChat(state, 'alice', true, lisbon(clock)), false);
  }
  for (const clock of ['22:28:00', '22:29:59', '22:30:00', '22:47:59']) {
    assert.equal(canJoinLobbyQueue(state, 'alice', true, lisbon(clock)), true);
    assert.equal(canJoinLobbyQueue(state, 'alice', false, lisbon(clock)), false);
    assert.equal(canJoinLobbyQueue(state, 'bob', true, lisbon(clock)), false);
    assert.equal(canJoinLobbyQueue(state, undefined, true, lisbon(clock)), false);
  }
  assert.equal(shouldEnterChat(state, 'alice', false, lisbon('22:30:00')), false); // pending/refused terms
  assert.equal(shouldEnterChat(state, 'bob', true, lisbon('22:30:00')), false);
  assert.equal(shouldEnterChat(state, 'alice', true, lisbon('22:30:00', '2026-10-06')), false);
  assert.equal(shouldEnterChat({ ...state, queueDay: null }, 'alice', true, lisbon('22:30:00')), false);
  assert.equal(shouldEnterChat({ ...state, isQueueing: false }, 'alice', true, lisbon('22:30:00')), false);
});

test('legacy undated intent cannot auto-join, while its room context is retained', () => {
  const storage = storageFixture();
  storage.setItem('campus-chat-storage', JSON.stringify({ version: 0, state: {
    ownerId: 'alice', isQueueing: true, roomId: 'legacy-room', peerId: 'bob',
    messages: [{ id: 'legacy-message', text: 'fixture' }],
  } }));
  const state = reloadStore(storage).getState();
  assert.equal(state.queueDay, null);
  assert.equal(shouldEnterChat(state, 'alice', true, lisbon('22:30:00')), false);
  assert.equal(state.roomId, 'legacy-room');
  assert.equal(state.messages.length, 1);
});

test('queue cancellation and cutoff retain room, messages, votes and owner', () => {
  const storage = storageFixture();
  let store = reloadStore(storage);
  store.getState().setOwner('alice');
  store.getState().setRoom('room-a', 'bob');
  store.getState().addMessage({ id: 'm1', sender_id: 'alice', text: 'fixture', timestamp: '2026-10-05T21:40:00Z' });
  store.getState().setExtended(true);
  store.getState().setPeerExtended(true);
  store.getState().setQueueing(false);
  store = reloadStore(storage);
  const state = store.getState();
  assert.equal(state.ownerId, 'alice');
  assert.equal(state.roomId, 'room-a');
  assert.equal(state.peerId, 'bob');
  assert.equal(state.messages.length, 1);
  assert.equal(state.extended, true);
  assert.equal(state.peerExtended, true);
  assert.equal(canJoinLobbyQueue(state, 'alice', true, lisbon('22:49:59')), false);
  assert.equal(shouldEnterChat(state, 'alice', true, lisbon('22:40:00')), false);
  store.getState().setOwner('carol');
  assert.equal(store.getState().roomId, null);
  assert.equal(store.getState().messages.length, 0);
  assert.equal(store.getState().queueDay, null);
});

test('suggestion handles returned errors, exceptions, malformed and confirmed responses', async () => {
  assert.equal(await saveLobbySuggestion(() => Promise.resolve({ error: { message: 'fixture failure' } })), false);
  assert.equal(await saveLobbySuggestion(() => { throw new Error('offline'); }), false);
  assert.equal(await saveLobbySuggestion(() => Promise.reject(new Error('offline'))), false);
  assert.equal(await saveLobbySuggestion(() => Promise.resolve({})), false);
  assert.equal(await saveLobbySuggestion(() => Promise.resolve({ error: null })), true);
});
