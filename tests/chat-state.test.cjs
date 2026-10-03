const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./load-ts.cjs');
const { roomView } = load('src/lib/chatSession.ts');
const start = Date.parse('2026-10-02T21:30:00Z');
const room = { expires_at: new Date(start + 120000).toISOString(),
  hard_close_at: new Date(start + 1200000).toISOString(),
  decision_until: new Date(start + 150000).toISOString(), ended_at: null };
test('expiry shows decision before read-only, including reload at expiry', () => {
  assert.equal(roomView(room, start + 120000).phase, 'decision');
  assert.equal(roomView(room, start + 150000).phase, 'closed');
  assert.equal(roomView(room, start + 60000).timeLeft, 60);
});
test('server extension resumes active state without local read-only residue', () => {
  const extended = { ...room, expires_at: new Date(start + 300000).toISOString(), decision_until: new Date(start + 300000).toISOString() };
  assert.equal(roomView(extended, start + 140000).phase, 'active');
  assert.equal(roomView(extended, start + 140000).timeLeft, 160);
});
test('hard cutoff uses >=, never exact-second equality', () => {
  assert.equal(roomView(room, start + 1201000).phase, 'closed');
  assert.equal(roomView({ ...room, ended_at: new Date(start).toISOString() }, start).phase, 'closed');
});
test('store deduplicates delivery/retry and new room clears old messages', () => {
  let state;
  const create = () => init => {
    state = init(update => { state = { ...state, ...(typeof update === 'function' ? update(state) : update) }; });
    return { getState: () => state };
  };
  const store = load('src/store/chatStore.ts', {
    zustand: { create },
    'zustand/middleware': { persist: init => init, createJSONStorage: () => ({}) },
  }).useChatStore;
  store.getState().setRoom('first', 'bob');
  store.getState().addMessage({ id: 'one', text: 'hello' });
  store.getState().addMessage({ id: 'one', text: 'hello' });
  assert.equal(store.getState().messages.length, 1);
  store.getState().setRoom('second', 'carol');
  assert.equal(store.getState().messages.length, 0);
  store.getState().resetChat(); store.getState().setQueueing(true);
  assert.equal(store.getState().roomId, null);
  assert.equal(store.getState().isQueueing, true);
});
