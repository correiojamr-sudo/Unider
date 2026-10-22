import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { TARGET, plan, readConfig, authorisedTime, claimAttempt, runHosted, selectAttempt, parseArguments,
  broadcastObservation, subscriptionIssue } from '../scripts/hosted/private-chat-check.mjs';

const require = createRequire(import.meta.url);
const Serializer = require('@supabase/realtime-js/dist/main/lib/serializer.js').default;
function binaryFrame(topic, payload) {
  let frame;
  new Serializer().encode({ topic, join_ref: 'jão', ref: 'r𠮷', event: 'broadcast',
    payload: { type: 'broadcast', event: 'message', payload } }, value => { frame = value; });
  return frame;
}

const config = { ref: TARGET.ref, url: TARGET.url, publishable: 'sb_publishable_OFFLINE', secret: 'sb_secret_OFFLINE' };
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const httpDate = 'Thu, 22 Oct 2026 21:30:00 GMT';

function fixture(options = {}) {
  let sequence = 0, elapsed = 0;
  const scheduled = [];
  const users = new Map(); const clients = []; const rooms = []; const history = [];
  const calls = []; const reports = []; const received = new Map();
  const controls = new Map();
  let pendingA;
  class Socket {
    constructor() {}
    send(frame) { calls.push({ type: 'ws-frame', binary: frame instanceof ArrayBuffer }); }
  }
  const deliver = message => {
    for (const [label, callback] of received) {
      if (label !== 'C' || options.leakToC) callback({ payload: message });
    }
  };
  const adminApi = {
    async createUser(args) {
      calls.push({ type: 'create', args });
      const label = args.user_metadata.registration_name.at(-1);
      const user = { id: uuid(100 + users.size), email: args.email, user_metadata: args.user_metadata };
      users.set(user.id, user);
      if (options.ambiguousCreate === label) throw new Error('SECRET raw create error');
      return { data: { user }, error: null };
    },
    async getUserById(id) {
      calls.push({ type: 'get-user', id });
      const user = users.get(id);
      if (!user) return { data: { user: null }, error: { status: 404 } };
      return { data: { user: options.changedOwner === id ? { ...user, user_metadata: {} } : user }, error: null };
    },
    async signOut(token) { calls.push({ type: 'revoke', token }); return { error: null }; },
    async deleteUser(id) { calls.push({ type: 'delete', id }); users.delete(id); return { error: null }; },
    async listUsers(args) {
      calls.push({ type: 'list', args });
      return { data: { users: [...users.values(), { id: uuid(999), email: 'real@student.uc.pt', user_metadata: {} }] }, error: null };
    },
  };
  function createClient(url, key, settings) {
    const admin = key === config.secret;
    const client = { label: admin ? 'admin' : ['A', 'B', 'C'][clients.filter(item => item.label !== 'admin').length],
      auth: { admin: adminApi,
        async signInWithPassword(args) {
          calls.push({ type: 'login', key, args });
          const user = [...users.values()].find(user => user.email === args.email);
          return { data: { user, session: { user, access_token: `SECRET-token-${user.id}` } }, error: null };
        },
        async dispose() {},
      },
      from(table) {
        let excludesFixtures = false;
        const query = {
          select() { return this; }, eq() { return this; },
          not(column) { if (column === 'id') excludesFixtures = true; return this; },
          then(resolve) {
            calls.push({ type: 'preflight', table, excludesFixtures });
            const newlyAccepted = table === 'profiles' && options.acceptedAfterCreation && users.size >= options.acceptedAfterCreation;
            return Promise.resolve({ data: null, error: null, count: options.preexisting === table || newlyAccepted ? 1 : 0 }).then(resolve);
          },
        };
        return query;
      },
      realtime: { async setAuth() {}, disconnect() {} },
      async removeChannel(channel) { calls.push({ type: 'remove-channel', label: client.label }); received.delete(client.label); channel.closed = true; },
      channel(topic, settingsChannel) {
        assert.equal(settingsChannel.config.private, true);
        const socket = new settings.realtime.transport(`${TARGET.url.replace('https:', 'wss:')}/realtime/v1/websocket?apikey=OFFLINE`);
        const channel = {
          on(_type, _filter, callback) { received.set(client.label, callback); return this; },
          subscribe(callback) {
            calls.push({ type: 'subscribe', label: client.label, topic });
            queueMicrotask(() => {
              const events = options.subscriptionEvents?.[client.label];
              if (events) {
                for (const event of events) {
                  if (event.after) scheduled.push({ due: elapsed + event.after, callback: () => callback(event.status, event.error) });
                  else callback(event.status, event.error);
                }
              } else if (client.label === 'C') callback(options.thirdStatus ?? 'CHANNEL_ERROR', new Error(options.thirdError ?? 'You do not have permissions to read from this Topic'));
              else callback('SUBSCRIBED');
            }); return this;
          },
          async send(args) {
            if (options.wsFallback) await settings.global.fetch(`${TARGET.url}/realtime/v1/api/broadcast`, { method: 'POST', body: '{}' });
            else socket.send(options.binaryWs ? binaryFrame(`realtime:${topic}`, args.payload)
              : JSON.stringify([null, '1', `realtime:${topic}`, 'broadcast', args]));
            if (options.leakClient) deliver(args.payload);
            return 'ok';
          },
        };
        return channel;
      },
      async rpc(name, args) {
        calls.push({ type: 'rpc', label: client.label, name, args, elapsed });
        if (name === 'find_or_join_match' && client.label === 'A' && !pendingA) { pendingA = args; return { data: { status: 'waiting' }, error: null }; }
        const own = [...users.values()].find(user => user.user_metadata.registration_name.endsWith(client.label));
        const peer = [...users.values()].find(user => user.user_metadata.registration_name.endsWith(client.label === 'A' ? 'B' : 'A'));
        if (!rooms.length) rooms.push(uuid(600));
        return { data: { status: 'matched', room_id: rooms[0], peer_id: options.foreignPeer ? uuid(999) : peer.id, ended_at: null, own: own.id }, error: null };
      },
      functions: {
        async invoke(name, { body }) {
          calls.push({ type: 'function', label: client.label, name });
          if (options.functionFailure) throw new Error('SECRET raw request error');
          if (name === 'get-room-messages') return { data: { success: true, roomId: body.roomId, partial: true, messages: history }, error: null };
          const user = [...users.values()].find(user => user.user_metadata.registration_name.endsWith(client.label));
          const message = { ...body.message, sender_id: user.id };
          if (!history.some(item => item.id === message.id)) history.push(message);
          controls.set(message.id, message);
          if (!options.dropControl) deliver(message);
          return { data: { success: true, message }, error: null };
        },
      },
    };
    const rpc = client.rpc;
    client.rpc = (...args) => {
      const pending = rpc(...args);
      pending.abortSignal = () => pending;
      return pending;
    };
    calls.push({ type: 'client', key, url }); clients.push(client); return client;
  }
  const deps = {
    uuid: () => uuid(++sequence), password: () => 'SECRET-memory-password', createClient, WebSocket: Socket,
    claimAttempt: async () => { calls.push({ type: 'claim-attempt' }); },
    monotonic: () => elapsed,
    wait: async milliseconds => {
      elapsed += milliseconds + (options.fractionalClock ? 0.123 : 0);
      scheduled.sort((first, second) => first.due - second.due);
      while (scheduled[0]?.due <= elapsed) scheduled.shift().callback();
    },
    async fetch(url, args) {
      calls.push({ type: 'fetch', url, args });
      if (url.includes('/health?')) return new Response('{}', { headers: { Date: options.date ?? httpDate } });
      if (options.leakRest && args.body !== '{}') deliver(JSON.parse(args.body).messages[0].payload);
      return new Response(null, { status: options.restStatus ?? 202 });
    },
    async writeReport(report) { reports.push(JSON.parse(JSON.stringify(report))); },
  };
  return { deps, calls, users, reports, clients, controls };
}

test('default plan and CLI --plan do not load configuration, create clients or use network', async () => {
  const poison = new Proxy({}, { get() { throw new Error('configuration was read'); } });
  assert.deepEqual(await runHosted({ config: poison }, poison), plan());
  const result = spawnSync(process.execPath, ['scripts/hosted/private-chat-check.mjs', '--plan'], { encoding: 'utf8' });
  assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).network, false);
  assert.equal(JSON.parse(result.stdout).accountsCreated, 0);
});

test('only the exact authorised target and separate public/server keys are accepted', () => {
  const env = { SUPABASE_HOSTED_TEST_PROJECT_REF: config.ref, SUPABASE_HOSTED_TEST_URL: config.url,
    SUPABASE_HOSTED_TEST_PUBLISHABLE_KEY: config.publishable, SUPABASE_HOSTED_TEST_SECRET_KEY: config.secret };
  assert.deepEqual(readConfig(env), config);
  for (const changes of [{ SUPABASE_HOSTED_TEST_PROJECT_REF: 'other' }, { SUPABASE_HOSTED_TEST_URL: config.url + '/' },
    { SUPABASE_HOSTED_TEST_URL: 'https://other.supabase.co' }, { SUPABASE_HOSTED_TEST_PUBLISHABLE_KEY: config.secret },
    { SUPABASE_HOSTED_TEST_SECRET_KEY: config.publishable }]) assert.throws(() => readConfig({ ...env, ...changes }));
});

test('date and creation window use the HTTP Date in Lisbon, including exact boundaries', () => {
  for (const date of ['Thu, 22 Oct 2026 21:29:59 GMT', 'Thu, 22 Oct 2026 21:43:00 GMT',
    'Fri, 23 Oct 2026 21:30:00 GMT', '', undefined, 'invalid']) assert.throws(() => authorisedTime(date));
  assert.deepEqual(authorisedTime(httpDate), { day: '2026-10-22', time: '22:30:00' });
  assert.equal(authorisedTime('Thu, 22 Oct 2026 21:42:59 GMT').time, '22:42:59');
});

test('only the original and explicitly selected approved retry profiles exist; flags never authorise arbitrary dates', async () => {
  assert.equal(selectAttempt().id, 'original');
  assert.deepEqual(parseArguments([]), { mode: 'plan' });
  assert.deepEqual(parseArguments(['--execute', '--attempt-id', 'retry-20261022', '--date', '2026-10-22']),
    { mode: 'execute', attemptId: 'retry-20261022', date: '2026-10-22' });
  for (const args of [['--attempt-id', 'retry-20261022'], ['--date', '2026-10-22'],
    ['--execute', '--attempt-id', 'arbitrary', '--date', '2026-10-22'],
    ['--execute', '--attempt-id', 'retry-20261022', '--date', '2026-10-23'],
    ['--execute', '--execute'], ['--execute', '--date', '2026-10-22', '--date', '2026-10-22'], ['--unknown']]) {
    assert.throws(() => parseArguments(args));
  }
  const requested = { attemptId: 'retry-20261022', date: '2026-10-22' };
  const f = fixture({ date: 'Thu, 22 Oct 2026 21:43:00 GMT' });
  const report = await runHosted({ mode: 'execute', config, ...requested }, f.deps);
  assert.equal(report.status, 'aborted');
  assert.equal(f.calls.filter(call => call.type === 'create' || call.type === 'claim-attempt').length, 0);
  const result = spawnSync(process.execPath, ['scripts/hosted/private-chat-check.mjs', '--plan', '--attempt-id', requested.attemptId, '--date', requested.date], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).attempt.id, requested.attemptId);
  assert.equal(JSON.parse(result.stdout).network, false);
});

test('all preflight fences abort before account creation', async () => {
  for (const options of [{ date: 'Fri, 23 Oct 2026 21:30:00 GMT' }, { date: 'Thu, 22 Oct 2026 21:29:00 GMT' },
    { preexisting: 'active_rooms' }, { preexisting: 'matchmaking_queue' }, { preexisting: 'profiles' }]) {
    const f = fixture(options); const report = await runHosted({ mode: 'execute', config }, f.deps);
    assert.equal(report.status, 'aborted');
    assert.equal(f.calls.filter(call => call.type === 'create').length, 0);
    assert.equal(f.calls.filter(call => call.type === 'claim-attempt').length, 0);
  }
});

test('one atomic attempt marker survives cleanup and rejects replay; outside-window abort does not consume it', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'unider-hosted-plan-'));
  t.after(async () => {
    await rm(join(directory, `${TARGET.ref}-${TARGET.day}.attempt.json`), { force: true });
    await rmdir(directory);
  });
  const options = { date: 'Thu, 22 Oct 2026 21:29:00 GMT' };
  const f = fixture(options);
  f.deps.claimAttempt = args => claimAttempt(args, directory);
  assert.equal((await runHosted({ mode: 'execute', config }, f.deps)).status, 'aborted');
  options.date = httpDate;
  assert.equal((await runHosted({ mode: 'execute', config }, f.deps)).status, 'passed');
  const replay = await runHosted({ mode: 'execute', config }, f.deps);
  assert.equal(replay.status, 'aborted');
  assert.ok(replay.checks.some(check => check.code === 'attempt_already_claimed'));
  assert.equal(f.calls.filter(call => call.type === 'create').length, 3);
});

test('approved retry gets a separate atomic marker without consuming or removing the original marker', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'unider-hosted-retry-'));
  const original = join(directory, `${TARGET.ref}-${TARGET.day}.attempt.json`);
  const retry = join(directory, `${TARGET.ref}-${TARGET.day}-retry-20261022.attempt.json`);
  t.after(async () => { await rm(original, { force: true }); await rm(retry, { force: true }); await rmdir(directory); });
  await claimAttempt({ runId: uuid(1) }, directory);
  const preserved = await readFile(original, 'utf8');
  const approved = { runId: uuid(2), attemptId: 'retry-20261022', date: '2026-10-22' };
  await claimAttempt(approved, directory);
  assert.equal(await readFile(original, 'utf8'), preserved);
  assert.equal(JSON.parse(await readFile(retry, 'utf8')).attemptId, approved.attemptId);
  await assert.rejects(claimAttempt({ runId: uuid(3) }, directory), /attempt_already_claimed/);
  await assert.rejects(claimAttempt({ ...approved, runId: uuid(3) }, directory), /attempt_already_claimed/);
  await assert.rejects(claimAttempt({ ...approved, attemptId: 'arbitrary' }, directory), /attempt_not_authorised/);
});

test('installed SDK serializer emits binary kind 3 and the observer reads its UTF-8 header and JSON ID without retaining content', () => {
  const topic = `realtime:room:${uuid(600)}`;
  const frame = binaryFrame(topic, { id: uuid(500), text: 'SECRET synthetic content', access_token: 'SECRET-token' });
  assert.ok(frame instanceof ArrayBuffer);
  assert.equal(new Uint8Array(frame)[0], 3);
  const expected = { topic, id: uuid(500), codec: 'phoenix_binary_v2' };
  assert.deepEqual(broadcastObservation(frame), expected);
  const padded = new Uint8Array(frame.byteLength + 10); padded.set(new Uint8Array(frame), 5);
  assert.deepEqual(broadcastObservation(padded.subarray(5, padded.length - 5)), expected);
  assert.deepEqual(broadcastObservation(JSON.stringify([null, '1', topic, 'broadcast', { event: 'message', payload: { id: uuid(500), text: 'SECRET' } }])),
    { ...expected, codec: 'phoenix_json' });
  for (const malformed of [null, 'not JSON', new Uint8Array([3, 255, 255, 255, 255, 255, 1]), frame.slice(0, 6),
    JSON.stringify([null, '1', topic, 'phx_join', { payload: { id: uuid(500), access_token: 'SECRET' } }])]) {
    assert.equal(broadcastObservation(malformed), null);
  }
});

test('transient A/B events recover through the same SDK subscription within one 20-second budget and keep heartbeats', async () => {
  const f = fixture({ binaryWs: true, subscriptionEvents: {
    A: [{ status: 'CHANNEL_ERROR', error: new Error('MissingPartition') }, { after: 1_000, status: 'TIMED_OUT' }, { after: 10_500, status: 'SUBSCRIBED' }],
    B: [{ status: 'CLOSED' }, { after: 2_000, status: 'CHANNEL_ERROR', error: { name: 'Error', cause: { code: 'TenantInitializing' } } },
      { after: 15_000, status: 'SUBSCRIBED' }],
  } });
  const report = await runHosted({ mode: 'execute', config, attemptId: 'retry-20261022', date: '2026-10-22' }, f.deps);
  assert.equal(report.status, 'passed');
  assert.equal(report.attempt.id, 'retry-20261022');
  assert.ok(report.subscriptionBudget.elapsedMilliseconds >= 15_000 && report.subscriptionBudget.elapsedMilliseconds <= 15_100);
  assert.equal(f.calls.filter(call => call.type === 'create').length, 3);
  assert.equal(f.calls.filter(call => call.type === 'subscribe').length, 3);
  assert.ok(report.checks.some(check => check.name === 'subscription_heartbeat'));
  assert.ok(report.subscriptions[0].events.some(event => event.code === 'missing_partition'));
  assert.ok(report.subscriptions[1].events.some(event => event.code === 'initializing'));
  assert.ok(report.checks.some(check => check.name === 'member_ws_no_delivery' && check.codec === 'phoenix_binary_v2'));
  for (const label of ['A', 'B']) {
    const heartbeats = f.calls.filter(call => call.type === 'rpc' && call.name === 'get_room_state' && call.label === label);
    assert.ok(heartbeats.some(call => call.elapsed >= 8_000 && call.elapsed < 15_000));
    assert.ok(heartbeats.every((call, index) => !index || call.elapsed - heartbeats[index - 1].elapsed < 45_000));
  }
});

test('explicit A/B authorization refusal fails immediately while C timeout remains inconclusive at the total budget', async () => {
  for (const label of ['A', 'B']) {
    const f = fixture({ subscriptionEvents: { [label]: [{ status: 'CHANNEL_ERROR', error: { name: 'Error', cause: { code: 'Unauthorized' } } }] } });
    const report = await runHosted({ mode: 'execute', config }, f.deps);
    assert.equal(report.status, 'failed');
    assert.ok(report.checks.some(check => check.code === 'member_subscription_denied'));
    assert.ok(report.subscriptionBudget.elapsedMilliseconds <= 100);
    assert.equal(f.calls.filter(call => call.type === 'function').length, 0);
    assert.equal(f.users.size, 0);
  }
  const f = fixture({ thirdStatus: 'TIMED_OUT', fractionalClock: true });
  const report = await runHosted({ mode: 'execute', config }, f.deps);
  assert.equal(report.status, 'inconclusive');
  assert.equal(report.subscriptionBudget.elapsedMilliseconds, 20_000);
  assert.ok(report.checks.some(check => check.code === 'subscription_budget_exhausted'));
  assert.ok(!report.checks.some(check => check.name === 'private_subscription_C'));
  assert.equal(f.calls.filter(call => call.type === 'function').length, 0);
});

test('subscription diagnostics allowlist codes/classes and discard malicious messages, tokens, claims and unknown status strings', async () => {
  assert.deepEqual(subscriptionIssue(new Error('InitializingProjectConnection')), { code: 'initializing', errorClass: 'Error' });
  const malicious = { name: 'SECRET attacker class', code: 'SECRET-token', message: 'SECRET password text',
    cause: { reason: 'SECRET JWT claims', code: 'SECRET-token', claims: { access_token: 'SECRET-token' } } };
  assert.deepEqual(subscriptionIssue(malicious), { code: 'unknown', errorClass: 'UnknownError' });
  const f = fixture({ subscriptionEvents: { A: [
    { status: 'CHANNEL_ERROR', error: malicious }, { after: 100, status: 'SECRET unknown status', error: malicious },
    { after: 200, status: 'SUBSCRIBED' },
  ] } });
  const report = await runHosted({ mode: 'execute', config }, f.deps);
  assert.equal(report.status, 'passed');
  assert.equal(report.subscriptions[0].events[1].status, 'UNKNOWN');
  const serialized = JSON.stringify(f.reports);
  for (const secret of ['SECRET', config.publishable, config.secret, 'synthetic hosted control', 'access_token', 'claims']) assert.ok(!serialized.includes(secret), secret);
});

test('three bounded fixtures use admin creation, public password login and exact cleanup; report contains no secrets/content', async () => {
  const f = fixture(); const report = await runHosted({ mode: 'execute', config }, f.deps);
  assert.equal(report.status, 'passed');
  assert.equal(f.calls.filter(call => call.type === 'create').length, 3);
  assert.equal(f.calls.filter(call => call.type === 'login').length, 3);
  assert.ok(f.calls.filter(call => call.type === 'login').every(call => call.key === config.publishable));
  assert.ok(f.calls.filter(call => call.type === 'create').every(call => call.args.email_confirm === true &&
    call.args.user_metadata.birth_date === '2000-01-01' && call.args.user_metadata.adult === true && call.args.user_metadata.terms_version === '2.1'));
  assert.deepEqual(new Set(f.calls.filter(call => call.type === 'delete').map(call => call.id)), new Set(report.fixtures.map(item => item.userId)));
  assert.equal(f.users.size, 0); assert.equal(report.manualCleanupRequired, false);
  assert.ok(!f.calls.some(call => call.type === 'rpc' && call.label === 'C'));
  assert.ok(report.checks.some(check => check.name === 'redis_path_retry_history' && check.storedMessages === 1));
  for (const name of ['member_ws_no_delivery', 'member_rest_no_delivery', 'third_rest_no_delivery', 'anonymous_rest_no_delivery']) {
    assert.ok(report.checks.some(check => check.name === name));
    assert.ok(report.checks.some(check => check.name === name + '_control_before'));
    assert.ok(report.checks.some(check => check.name === name + '_control_after'));
  }
  const serialized = JSON.stringify(f.reports);
  for (const secret of ['SECRET', config.secret, config.publishable, 'synthetic hosted control', 'synthetic client injection', 'registration_name']) assert.ok(!serialized.includes(secret), secret);
});

test('foreign peer aborts before messages and C timeout/transport failure never proves refusal', async () => {
  for (const options of [{ foreignPeer: true }, { thirdStatus: 'TIMED_OUT' }, { thirdError: 'network connection failed' }]) {
    const f = fixture(options); const report = await runHosted({ mode: 'execute', config }, f.deps);
    assert.notEqual(report.status, 'passed');
    assert.equal(f.calls.filter(call => call.type === 'function').length, 0);
    assert.equal(f.users.size, 0);
  }
});

test('non-delivery requires positive controls and observed WS; client leakage fails even with HTTP 202', async () => {
  for (const options of [{ dropControl: true }, { wsFallback: true }, { leakClient: true }, { leakRest: true }, { restStatus: 503 }]) {
    const f = fixture(options); const report = await runHosted({ mode: 'execute', config }, f.deps);
    assert.notEqual(report.status, 'passed'); assert.equal(f.users.size, 0);
    assert.equal(report.manualCleanupRequired, false);
    if (options.wsFallback) assert.ok(report.checks.some(check => check.code === 'websocket_transport_unconfirmed'));
    if (options.leakClient || options.leakRest) assert.ok(report.checks.some(check => check.code === 'client_broadcast_delivered'));
  }
});

test('ambiguous creation reconciles only exact UUID email plus marker and never retries creation', async () => {
  const f = fixture({ ambiguousCreate: 'B' }); const report = await runHosted({ mode: 'execute', config }, f.deps);
  assert.equal(report.status, 'inconclusive'); assert.equal(f.users.size, 0);
  assert.equal(f.calls.filter(call => call.type === 'create').length, 2);
  assert.equal(f.calls.filter(call => call.type === 'delete').length, 2);
  assert.ok(!f.calls.some(call => call.type === 'delete' && call.id === uuid(999)));
  assert.equal(report.fixtures[1].creation, 'reconciled');
});

test('cleanup preserves a user whose marker no longer matches and reports manual reconciliation', async () => {
  const f = fixture({ functionFailure: true, changedOwner: uuid(100) });
  const report = await runHosted({ mode: 'execute', config }, f.deps);
  assert.equal(report.status, 'inconclusive'); assert.equal(report.manualCleanupRequired, true);
  assert.ok(!f.calls.some(call => call.type === 'delete' && call.id === uuid(100)));
  assert.equal(f.calls.filter(call => call.type === 'delete').length, 2);
});
