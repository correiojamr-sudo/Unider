const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
function storage() { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; }
function loader(overrides = {}, globals = {}) {
  const cache = new Map();
  return function load(file) {
    const filename = path.resolve(file);
    if (filename in overrides) return overrides[filename];
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} }; cache.set(filename, module.exports);
    const source = fs.readFileSync(filename, 'utf8').replaceAll('import.meta.env', '({ VITE_SUPABASE_URL: "http://localhost:54321", VITE_SUPABASE_ANON_KEY: "sb_publishable_auth_fixture_only" })');
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(output, { module, exports: module.exports, require: name => name.startsWith('.')
      ? load(path.resolve(path.dirname(filename), name.endsWith('.ts') ? name : name + '.ts')) : require(name),
      console, URL, atob, Date, Error, DOMException, AbortSignal, AbortController, Response, crypto: globalThis.crypto, setTimeout, clearTimeout,
      sessionStorage: storage(), localStorage: storage(), fetch: () => { throw new Error('External request forbidden'); }, ...globals }, { filename });
    return module.exports;
  };
}
const load = loader();
const { normalizeInstitutionalEmail, validEmailOtp, authErrorMessage, runAuthOperation } = load('src/lib/authOperations.ts');
const { observeAuthSession } = load('src/lib/authSession.ts');

test('institutional email normalization rejects malformed full addresses; OTP accepts documented bounds', () => {
  assert.equal(normalizeInstitutionalEmail('  Nome.Aluno@STUDENT.UC.PT  '), 'nome.aluno@student.uc.pt');
  for (const email of ['@student.uc.pt', 'a@b@student.uc.pt', 'a b@student.uc.pt', '.a@student.uc.pt', 'a..b@student.uc.pt', 'a@student.uc.pt.evil', 'a@uc.pt']) assert.equal(normalizeInstitutionalEmail(email), null);
  for (const code of ['123456', '12345678', '1234567890']) assert.equal(validEmailOtp(code), true);
  for (const code of ['12345', '12345678901', '12345x']) assert.equal(validEmailOtp(code), false);
  assert.match(authErrorMessage({ code: 'otp_expired', message: 'SECRET' }, 'verify'), /expirou/);
  assert.match(authErrorMessage({ status: 429 }, 'send'), /um minuto/);
  assert.ok(!authErrorMessage({ message: 'SECRET' }, 'delete').includes('SECRET'));
});

test('async success, failure and finally apply only to the current operation', async () => {
  for (const failure of [false, true]) {
    const pending = deferred(); let current = true; const calls = [];
    const work = runAuthOperation({ request: () => pending.promise, current: () => current,
      confirmed: () => calls.push('success'), failed: () => calls.push('error'), settled: () => calls.push('finally') });
    current = false;
    if (failure) pending.reject(new Error('obsolete')); else pending.resolve(true);
    await work; assert.deepEqual(calls, []);
  }
  const calls = [];
  await runAuthOperation({ request: () => { throw new Error('offline'); }, current: () => true,
    confirmed: () => calls.push('success'), failed: () => calls.push('error'), settled: () => calls.push('finally') });
  assert.deepEqual(calls, ['error', 'finally']);
});

test('Auth event wins over startup success/rejection; teardown and external revision discard startup', async () => {
  for (const mode of ['success', 'reject', 'unmount', 'revision']) {
    const pending = deferred(); let event, revision = 0; const applied = []; let failures = 0;
    const stop = observeAuthSession({ subscribe: cb => { event = cb; return () => {}; }, getSession: () => pending.promise,
      revision: () => revision, apply: session => applied.push(session), failed: () => failures++ });
    await tick();
    if (mode === 'unmount') stop();
    else if (mode === 'revision') revision++;
    else event('SIGNED_IN', { user: { id: 'new' } });
    if (mode === 'reject') pending.reject(new Error('offline')); else pending.resolve({ data: { session: { user: { id: 'old' } } } });
    await tick(); stop();
    assert.equal(failures, 0);
    assert.deepEqual(applied.map(s => s.user.id), ['success', 'reject'].includes(mode) ? ['new'] : []);
  }
  let failures = 0;
  const stop = observeAuthSession({ subscribe: () => () => {}, getSession: () => Promise.reject(new Error('offline')),
    revision: () => 0, apply: () => assert.fail('unconfirmed session'), failed: () => failures++ });
  await tick(); stop(); assert.equal(failures, 1);
});

function authFixture() {
  const calls = []; const replies = new Map();
  const client = { rpc(name) { calls.push(name); const reply = replies.get(name) ?? Promise.resolve({ error: null }); reply.abortSignal = () => reply; return reply; } };
  let logoutReply = Promise.resolve({ error: null });
  const scoped = { withScopedAuth: async (current, signal, request) => {
    if (!current() || signal.aborted) throw new Error('obsolete');
    return request({ signOut: () => { calls.push('signOut'); return logoutReply; } });
  } };
  const load = loader({ [path.resolve('src/lib/supabase.ts')]: { supabase: client }, [path.resolve('src/lib/authSession.ts')]: scoped });
  const auth = load('src/store/authStore.ts').useAuthStore;
  const chat = load('src/store/chatStore.ts').useChatStore;
  const login = id => auth.getState().setSession({ user: { id } });
  login('alice'); chat.getState().setRoom('room-a', 'bob');
  return { auth, chat, calls, replies, login, logout: promise => { logoutReply = promise; } };
}

test('logout preserves session/context on failed leave and on network failure', async () => {
  for (const stage of ['leave_room', 'signOut']) {
    const f = authFixture();
    if (stage === 'leave_room') f.replies.set(stage, Promise.resolve({ error: { message: 'SECRET' } }));
    else f.logout(Promise.reject(new Error('offline')));
    assert.equal(await f.auth.getState().signOut(), false);
    assert.equal(f.auth.getState().user.id, 'alice');
    assert.equal(f.chat.getState().roomId, 'room-a');
    assert.equal(f.auth.getState().isSigningOut, false);
    assert.match(f.auth.getState().signOutError, /não foi confirmada/);
    assert.ok(!f.auth.getState().signOutError.includes('SECRET'));
    if (stage === 'leave_room') assert.deepEqual(f.calls, ['leave_room']);
  }
});

test('old logout cannot clear a newer identity or chat', async () => {
  for (const stage of ['leave_room', 'signOut']) {
    const f = authFixture(); const pending = deferred();
    if (stage === 'leave_room') f.replies.set(stage, pending.promise); else f.logout(pending.promise);
    const work = f.auth.getState().signOut(); await tick();
    f.login('carol'); f.chat.getState().setRoom('room-new', 'dan');
    pending.resolve({ error: null }); await work;
    assert.equal(f.auth.getState().user.id, 'carol');
    assert.equal(f.chat.getState().roomId, 'room-new');
    assert.equal(f.auth.getState().signOutError, '');
  }
});

test('successful logout clears context; confirmed deletion skips leave RPCs', async () => {
  const f = authFixture();
  assert.equal(await f.auth.getState().signOutForContext({ accountDeleted: true, expectedContextVersion: f.auth.getState().contextVersion }), true);
  assert.deepEqual(f.calls, ['signOut']); assert.equal(f.auth.getState().session, null);
  assert.equal(f.chat.getState().roomId, null); assert.equal(f.chat.getState().isQueueing, false);
});

test('a fresh session for the same user invalidates a pending logout', async () => {
  const f = authFixture(); const pending = deferred();
  f.replies.set('leave_room', pending.promise);
  const work = f.auth.getState().signOut(); await tick();
  f.auth.getState().setSession({ user: { id: 'alice' }, access_token: 'new-session-fixture' });
  pending.resolve({ error: null }); assert.equal(await work, false);
  assert.deepEqual(f.calls, ['leave_room']);
  assert.equal(f.auth.getState().session.access_token, 'new-session-fixture');
});

test('installed SDK stages OTP/logout storage; old responses and failed logout cannot mutate primary credentials', async () => {
  for (const operation of ['verify-late', 'logout-late', 'logout-offline', 'verify-storage-replaced', 'verify-success']) {
    const local = storage(); const storageKey = 'sb-localhost-auth-token';
    const session = { access_token: 'fixture-only', refresh_token: 'fixture-only', expires_in: 3600, expires_at: Date.now() / 1000 + 3600, user: { id: 'alice' }, token_type: 'bearer' };
    if (!operation.startsWith('verify')) local.setItem(storageKey, JSON.stringify(session));
    const pending = deferred(); const notices = []; let current = true;
    class Channel { constructor(name) { this.name = name; } postMessage(value) { notices.push({ name: this.name, value }); } close() {} }
    const { withScopedAuth } = loader({}, { localStorage: local, BroadcastChannel: Channel,
      fetch: async () => {
        if (operation === 'logout-offline') throw new TypeError('fixture offline');
        await pending.promise;
        return operation.startsWith('verify') ? new Response(JSON.stringify(session), { status: 200, headers: { 'Content-Type': 'application/json' } }) : new Response(null, { status: 204 });
      } })('src/lib/authSession.ts');
    const work = withScopedAuth(() => current, new AbortController().signal, auth => operation.startsWith('verify')
      ? auth.verifyOtp({ email: 'fixture@student.uc.pt', token: '123456', type: 'email' }) : auth.signOut());
    const checked = work.then(result => ({ result }), error => ({ error }));
    await tick();
    if (operation.endsWith('late')) { current = false; local.setItem(storageKey, 'newer-session-fixture'); }
    if (operation.endsWith('replaced')) local.setItem(storageKey, 'other-tab-newer-session');
    pending.resolve(); const outcome = await checked;
    if (operation.endsWith('late')) assert.equal(local.getItem(storageKey), 'newer-session-fixture');
    if (operation.endsWith('replaced')) assert.equal(local.getItem(storageKey), 'other-tab-newer-session');
    if (operation === 'logout-offline') { assert.ok(outcome.result.error); assert.equal(local.getItem(storageKey), JSON.stringify(session)); }
    if (operation === 'verify-success') {
      assert.equal(JSON.parse(local.getItem(storageKey)).user.id, 'alice');
      assert.deepEqual(notices, [{ name: 'unider-auth-storage-changes', value: 'changed' }]);
    } else assert.deepEqual(notices, []);
  }
});

test('scoped primary key matches the installed SupabaseClient, including localhost with a port', async () => {
  const { createClient } = require('@supabase/supabase-js');
  const client = createClient('http://localhost:54321', 'public-anon-key', { auth: { skipAutoInitialize: true, autoRefreshToken: false } });
  try {
    assert.equal(client.auth.storageKey, 'sb-localhost-auth-token');
    const local = storage(); local.setItem(client.auth.storageKey, 'exact-key-fixture');
    const { withScopedAuth } = loader({}, { localStorage: local })('src/lib/authSession.ts');
    await withScopedAuth(() => true, new AbortController().signal, async auth => {
      assert.equal(await auth.storage.getItem(auth.storageKey), 'exact-key-fixture'); return { error: null };
    });
  } finally { await client.auth.dispose(); }
});
