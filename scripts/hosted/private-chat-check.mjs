// Manual, explicitly authorised hosted check. Never imported by the database harness.
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TARGET = Object.freeze({
  ref: 'ymzcsoyylrpkdflnlvkg',
  url: 'https://ymzcsoyylrpkdflnlvkg.supabase.co',
  day: '2026-10-22',
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_MS = 10_000;
const SUBSCRIBE_MS = 8_000;
const HANDSHAKE_MS = 20_000;
const DELIVERY_MS = 6_000;
const OBSERVE_MS = 1_500;
const ATTEMPTS = Object.freeze({
  original: Object.freeze({ id: 'original', day: TARGET.day }),
  'retry-20261022': Object.freeze({ id: 'retry-20261022', day: '2026-10-22' }),
});

class CheckFailure extends Error {
  constructor(code, status = 'failed') { super(code); this.code = code; this.status = status; }
}
function requireCheck(condition, code, status) {
  if (!condition) throw new CheckFailure(code, status);
}
function publicFailure(error) {
  return error instanceof CheckFailure ? { code: error.code, status: error.status }
    : { code: 'request_failed', status: 'inconclusive' };
}
function unwrap(result, code) {
  requireCheck(result && !result.error, code, 'inconclusive');
  return result.data;
}

export function selectAttempt(attemptId, date) {
  if (attemptId === undefined && date === undefined) return ATTEMPTS.original;
  requireCheck(typeof attemptId === 'string' && Object.hasOwn(ATTEMPTS, attemptId)
    && typeof date === 'string' && ATTEMPTS[attemptId].day === date, 'attempt_not_authorised', 'aborted');
  return ATTEMPTS[attemptId];
}

export function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--plan' || flag === '--execute') {
      requireCheck(!options.mode, 'invalid_arguments', 'aborted');
      options.mode = flag.slice(2);
    } else {
      const property = flag === '--attempt-id' ? 'attemptId' : flag === '--date' ? 'date' : null;
      requireCheck(property && !Object.hasOwn(options, property) && index + 1 < args.length, 'invalid_arguments', 'aborted');
      options[property] = args[++index];
    }
  }
  selectAttempt(options.attemptId, options.date);
  return { mode: 'plan', ...options };
}

export function plan(attempt = ATTEMPTS.original) {
  return {
    mode: 'plan', target: TARGET, attempt, network: false, accountsCreated: 0,
    execute: 'node scripts/hosted/private-chat-check.mjs --execute' + (attempt.id === 'original' ? '' : ` --attempt-id ${attempt.id} --date ${attempt.day}`),
    windowLisbon: '2026-10-22 22:30 inclusive to 22:43 exclusive; HTTP Date required',
    checks: ['empty rooms/queue and no accepted real 2.1 profiles', 'at most three auto-confirmed fixtures',
      'normal password login', 'A/B private subscription; C explicit refusal',
      'server delivery, retry and Redis-backed history', 'member WS and member/C/anonymous REST non-delivery with controls'],
    attemptGuard: 'fixed original/retry profiles; each has an atomic marker that is never removed automatically',
    cleanup: 'revalidate exact fixture email and run marker; revoke known sessions and delete only own IDs',
    excluded: ['signup/email delivery', 'report-room', 'ban', 'retention/Cron', 'third-party WebSocket publish', 'direct Redis inspection'],
  };
}

export function readConfig(env) {
  const config = {
    ref: env.SUPABASE_HOSTED_TEST_PROJECT_REF, url: env.SUPABASE_HOSTED_TEST_URL,
    publishable: env.SUPABASE_HOSTED_TEST_PUBLISHABLE_KEY, secret: env.SUPABASE_HOSTED_TEST_SECRET_KEY,
  };
  requireCheck(config.ref === TARGET.ref && config.url === TARGET.url, 'target_not_authorised', 'aborted');
  const role = key => {
    try { return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; }
    catch { return null; }
  };
  requireCheck(typeof config.publishable === 'string' &&
    (config.publishable.startsWith('sb_publishable_') || role(config.publishable) === 'anon'), 'publishable_key_required', 'aborted');
  requireCheck(typeof config.secret === 'string' && config.secret !== config.publishable &&
    (config.secret.startsWith('sb_secret_') || role(config.secret) === 'service_role'), 'server_key_required', 'aborted');
  return config;
}

export function authorisedTime(httpDate, attemptId, date) {
  const attempt = selectAttempt(attemptId, date);
  requireCheck(typeof httpDate === 'string' && /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(httpDate)
    && Number.isFinite(Date.parse(httpDate)), 'server_date_missing', 'aborted');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(httpDate));
  const part = type => parts.find(item => item.type === type).value;
  const day = `${part('year')}-${part('month')}-${part('day')}`;
  const time = `${part('hour')}:${part('minute')}:${part('second')}`;
  requireCheck(day === attempt.day, 'date_not_authorised', 'aborted');
  requireCheck(time >= '22:30:00' && time < '22:43:00', 'outside_authorised_window', 'aborted');
  return { day, time };
}

function ownership(user, fixture, runId) {
  return !!user && UUID.test(user.id) && (!fixture.id || user.id === fixture.id) && user.email === fixture.email &&
    user.user_metadata?.hosted_test_run === runId && user.user_metadata?.hosted_test_fixture === fixture.key;
}

// Decode only the outgoing broadcast envelope and retain its ID/topic/codec.
// SDK 2.117.2 uses binary kind 3 for JSON user broadcasts over Phoenix vsn 2.
export function broadcastObservation(value) {
  try {
    let topic, event, payload, codec;
    if (typeof value === 'string') {
      const frame = JSON.parse(value);
      const outerEvent = Array.isArray(frame) ? frame[3] : frame.event;
      const envelope = Array.isArray(frame) ? frame[4] : frame.payload;
      if (outerEvent !== 'broadcast') return null;
      topic = Array.isArray(frame) ? frame[2] : frame.topic;
      event = envelope?.event; payload = envelope?.payload; codec = 'phoenix_json';
    } else {
      const bytes = ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : value instanceof ArrayBuffer ? new Uint8Array(value) : null;
      if (!bytes || bytes.length < 7 || bytes[0] !== 3 || bytes[6] !== 1) return null;
      const topicStart = 7 + bytes[1] + bytes[2];
      const eventStart = topicStart + bytes[3];
      const payloadStart = eventStart + bytes[4] + bytes[5];
      if (payloadStart >= bytes.length) return null;
      const decoder = new TextDecoder('utf-8', { fatal: true });
      topic = decoder.decode(bytes.subarray(topicStart, eventStart));
      event = decoder.decode(bytes.subarray(eventStart, eventStart + bytes[4]));
      payload = JSON.parse(decoder.decode(bytes.subarray(payloadStart)));
      codec = 'phoenix_binary_v2';
    }
    return typeof topic === 'string' && event === 'message' && UUID.test(payload?.id)
      ? { topic, id: payload.id.toLowerCase(), codec } : null;
  } catch { return null; }
}

export function subscriptionIssue(error) {
  // Inspect fixed fields only. Never serialize error messages, causes or claims.
  const candidates = [error?.code, error?.cause?.code, error?.cause?.reason, error?.message]
    .filter(value => typeof value === 'string');
  const has = values => candidates.some(value => values.includes(value));
  const denied = has(['Unauthorized', 'Unauthorized access to Realtime channel.'])
    || candidates.some(value => /^You do not have permissions to read from this Topic(?:: [^\r\n]*)?$/.test(value));
  let code = denied ? 'unauthorized' : 'unknown';
  if (!denied) {
    if (has(['MissingPartition'])) code = 'missing_partition';
    else if (has(['TenantInitializing', 'InitializingTenantConnection', 'InitializingProjectConnection', 'RealtimeRestarting'])) code = 'initializing';
    else if (has(['TenantNotFound', 'TenantUnavailable', 'UnableToConnectToTenantDatabase', 'UnableToSetPolicies'])) code = 'tenant_unavailable';
    else if (has(['timeout', 'timed out']) || error?.name === 'TimeoutError') code = 'timeout';
    else if (error?.name === 'TypeError' || error?.name === 'AbortError') code = 'transport';
  }
  const errorClass = !error ? 'none' : ['Error', 'TypeError', 'TimeoutError', 'AbortError'].includes(error.name) ? error.name : 'UnknownError';
  return { code, errorClass };
}

function observedTransport(Base, observed) {
  return class extends Base {
    constructor(url, protocols) {
      const target = new URL(url);
      requireCheck(target.origin === TARGET.url.replace('https:', 'wss:') && target.pathname === '/realtime/v1/websocket', 'websocket_target_refused');
      super(url, protocols);
    }
    send(value) {
      const message = broadcastObservation(value);
      if (message) observed.set(`${message.topic}:${message.id}`, message.codec);
      return super.send(value);
    }
  };
}

export async function writeReport(report) {
  requireCheck(UUID.test(report.runId), 'invalid_report_id');
  const destination = resolve('node_modules/.cache/hosted-private-chat', `${report.runId}.json`);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
}

export async function claimAttempt({ runId, attemptId, date }, directory = resolve('node_modules/.cache/hosted-private-chat')) {
  const attempt = selectAttempt(attemptId, date);
  requireCheck(UUID.test(runId), 'invalid_run_id', 'aborted');
  await mkdir(directory, { recursive: true });
  try {
    const suffix = attempt.id === 'original' ? '' : `-${attempt.id}`;
    await writeFile(resolve(directory, `${TARGET.ref}-${attempt.day}${suffix}.attempt.json`),
      JSON.stringify({ target: TARGET.ref, day: attempt.day, attemptId: attempt.id, runId }) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    throw new CheckFailure(error?.code === 'EEXIST' ? 'attempt_already_claimed' : 'attempt_marker_unavailable', 'aborted');
  }
}

// Dependencies are injectable so the normal test suite never needs a key or network.
export async function runHosted({ mode = 'plan', config, attemptId, date } = {}, injected = {}) {
  const attempt = selectAttempt(attemptId, date);
  if (mode === 'plan') return plan(attempt);
  requireCheck(mode === 'execute', 'explicit_execute_required', 'aborted');
  readConfig({ SUPABASE_HOSTED_TEST_PROJECT_REF: config?.ref, SUPABASE_HOSTED_TEST_URL: config?.url,
    SUPABASE_HOSTED_TEST_PUBLISHABLE_KEY: config?.publishable, SUPABASE_HOSTED_TEST_SECRET_KEY: config?.secret });
  const deps = {
    fetch: globalThis.fetch, uuid: randomUUID, password: () => randomBytes(32).toString('base64url'),
    wait: ms => new Promise(done => setTimeout(done, ms)), monotonic: () => performance.now(),
    writeReport, claimAttempt, WebSocket: globalThis.WebSocket, cancelled: () => false, ...injected,
  };
  const runId = deps.uuid();
  requireCheck(UUID.test(runId), 'invalid_run_id', 'aborted');
  const report = { schema: 2, mode, runId, target: TARGET, attempt, status: 'inconclusive', checks: [], fixtures: [], subscriptions: [],
    excluded: plan().excluded, cleanup: [], manualCleanupRequired: false };
  const fixtures = [];
  const clients = [];
  const channels = [];
  const receipts = { A: new Set(), B: new Set(), C: new Set() };
  const blockedIds = [];
  let admin;
  let cleaning = false;
  let roomId;
  let matchStarted;
  let subscriptionFailure;
  let httpBroadcasts = 0;
  const wsObserved = new Map();
  const safeFetch = async (input, options = {}) => {
    requireCheck(cleaning || !deps.cancelled(), 'interrupted', 'aborted');
    const destination = new URL(typeof input === 'string' ? input : input.url);
    requireCheck(destination.origin === TARGET.url, 'http_target_refused');
    if (destination.pathname.startsWith('/realtime/v1/api/broadcast')) httpBroadcasts++;
    try {
      return await deps.fetch(input, { ...options, redirect: 'error',
        signal: AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(REQUEST_MS)]) });
    } catch { return new Response('{"message":"request unavailable","code":"request_failed"}', { status: 503 }); }
  };
  const check = (name, detail = {}) => report.checks.push({ name, status: 'passed', ...detail });
  const timeFence = async () => {
    const response = await safeFetch(`${TARGET.url}/auth/v1/health?hosted_check=${deps.uuid()}`, {
      headers: { apikey: config.publishable, Authorization: `Bearer ${config.publishable}`, 'Cache-Control': 'no-cache' },
    });
    const date = response.headers.get('date');
    await response.body?.cancel();
    requireCheck(response.ok, 'server_clock_unavailable', 'aborted');
    return authorisedTime(date, attempt.id, attempt.day);
  };
  const preflight = async () => {
    for (const table of ['active_rooms', 'matchmaking_queue']) {
      const result = await admin.from(table).select('*', { count: 'exact', head: true });
      unwrap(result, 'preflight_read_failed');
      requireCheck(result.count === 0, `preexisting_${table}`, 'aborted');
    }
    await noRealParticipants();
  };
  // Repeat the real-profile fence just before matching; returned peers are checked too.
  const noRealParticipants = async () => {
    const ids = fixtures.map(item => item.id);
    let query = admin.from('profiles').select('id', { count: 'exact', head: true })
      .eq('terms_version', '2.1').not('terms_accepted_at', 'is', null);
    if (ids.length) query = query.not('id', 'in', `(${ids.join(',')})`);
    const result = await query;
    unwrap(result, 'preflight_read_failed');
    requireCheck(result.count === 0, 'accepted_real_profile_present', 'aborted');
  };
  const pair = (data, index) => {
    requireCheck(data?.status === 'matched' && UUID.test(data.room_id) && data.peer_id === fixtures[1 - index].id,
      'unexpected_peer_or_room', 'aborted');
    requireCheck(!data.ended_at && (!roomId || roomId === data.room_id), 'room_not_active', 'inconclusive');
    return data;
  };
  const ensureSubscriptions = () => { if (subscriptionFailure) throw subscriptionFailure; };
  const refreshPair = async (budget = REQUEST_MS) => {
    ensureSubscriptions();
    requireCheck(!deps.cancelled(), 'interrupted', 'aborted');
    requireCheck(deps.monotonic() - matchStarted < 90_000, 'room_check_budget_exhausted', 'inconclusive');
    await Promise.all([0, 1].map(async index => {
      const response = await fixtures[index].client.rpc('get_room_state', { p_room: roomId })
        .abortSignal(AbortSignal.timeout(Math.max(1, Math.floor(Math.min(REQUEST_MS, budget)))));
      return pair(unwrap(response, 'room_refresh_failed'), index);
    }));
  };
  const waitFor = async (condition, duration) => {
    const attempts = Math.ceil(duration / 50);
    for (let attempt = 0; attempt < attempts; attempt++) {
      ensureSubscriptions();
      requireCheck(receipts.C.size === 0, 'outsider_received_message');
      if (condition()) return true;
      await deps.wait(50);
    }
    return condition();
  };
  const positive = async name => {
    await refreshPair();
    const id = deps.uuid();
    const result = unwrap(await fixtures[0].client.functions.invoke('send-message', {
      body: { roomId, message: { id, text: `synthetic hosted control ${id}` } },
    }), 'server_send_failed');
    requireCheck(result?.success === true && result.message?.id === id && result.message.sender_id === fixtures[0].id,
      'server_send_not_confirmed', 'inconclusive');
    requireCheck(await waitFor(() => receipts.A.has(id) && receipts.B.has(id), DELIVERY_MS), 'positive_control_not_delivered', 'inconclusive');
    check(name, { recipients: 2 });
    return { id, text: `synthetic hosted control ${id}` };
  };
  const subscription = (fixture, label) => {
    const observation = { fixture: label, events: [], result: 'pending' };
    report.subscriptions.push(observation);
    const channel = fixture.client.channel(`room:${roomId}`, {
      config: { private: true, broadcast: { ack: true, self: true } },
    }).on('broadcast', { event: 'message' }, ({ payload }) => {
      if (UUID.test(payload?.id)) receipts[label].add(payload.id);
    });
    channels.push({ client: fixture.client, channel });
    fixture.channel = channel;
    channel.subscribe((status, error) => {
      if (cleaning) return;
      const knownStatus = ['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status) ? status : 'UNKNOWN';
      const issue = subscriptionIssue(error);
      if (knownStatus === 'TIMED_OUT') issue.code = 'timeout';
      if (knownStatus === 'CLOSED') issue.code = 'channel_closed';
      if (knownStatus === 'SUBSCRIBED') issue.code = 'ok';
      if (observation.events.length < 32) observation.events.push({ status: knownStatus,
        atMilliseconds: Math.max(0, Math.round(deps.monotonic() - matchStarted)), ...issue });
      else observation.eventsTruncated = true;
      if (status === 'SUBSCRIBED') {
        observation.result = 'subscribed';
        if (label === 'C') subscriptionFailure = new CheckFailure('outsider_subscription_allowed');
      } else if (status === 'CHANNEL_ERROR' && issue.code === 'unauthorized') {
        observation.result = 'denied';
        if (label !== 'C') subscriptionFailure = new CheckFailure('member_subscription_denied');
      } else observation.result = 'pending';
    }, SUBSCRIBE_MS);
    return observation;
  };
  const observeSubscriptions = async () => {
    const started = deps.monotonic(), deadline = started + HANDSHAKE_MS;
    report.subscriptionBudget = { milliseconds: HANDSHAKE_MS, elapsedMilliseconds: 0 };
    try {
      await refreshPair(HANDSHAKE_MS);
      const observations = fixtures.map((fixture, index) => subscription(fixture, ['A', 'B', 'C'][index]));
      let heartbeatDue = deps.monotonic() + SUBSCRIBE_MS;
      while (true) {
        ensureSubscriptions();
        requireCheck(!deps.cancelled(), 'interrupted', 'aborted');
        const now = deps.monotonic();
        requireCheck(now < deadline, 'subscription_budget_exhausted', 'inconclusive');
        if (observations[0].result === 'subscribed' && observations[1].result === 'subscribed' && observations[2].result === 'denied') {
          for (const observation of observations) check(`private_subscription_${observation.fixture}`, { result: observation.result });
          return;
        }
        if (now >= heartbeatDue) {
          await refreshPair(deadline - now);
          heartbeatDue = deps.monotonic() + SUBSCRIBE_MS;
          check('subscription_heartbeat');
        }
        await deps.wait(Math.min(100, Math.max(1, deadline - deps.monotonic())));
      }
    } finally {
      report.subscriptionBudget.elapsedMilliseconds = Math.max(0, Math.round(deps.monotonic() - started));
    }
  };
  const negative = async (name, action) => {
    await positive(`${name}_control_before`);
    const id = deps.uuid(); blockedIds.push(id);
    const detail = await action({ id, sender_id: fixtures[0].id, text: 'synthetic client injection', timestamp: new Date().toISOString() });
    await deps.wait(OBSERVE_MS);
    requireCheck(!receipts.A.has(id) && !receipts.B.has(id), 'client_broadcast_delivered');
    await positive(`${name}_control_after`);
    requireCheck(!receipts.A.has(id) && !receipts.B.has(id), 'client_broadcast_delivered');
    check(name, { ...detail, observedMilliseconds: OBSERVE_MS, recipients: 0 });
  };
  try {
    const serverTime = await timeFence();
    check('server_time_fence', serverTime);
    const createClient = deps.createClient ?? (await import('@supabase/supabase-js')).createClient;
    const makeClient = key => {
      const client = createClient(TARGET.url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, skipAutoInitialize: true },
        global: { fetch: safeFetch },
        realtime: { logger: () => {}, transport: observedTransport(deps.WebSocket, wsObserved) },
      });
      clients.push(client);
      return client;
    };
    admin = makeClient(config.secret);
    await preflight();
    check('empty_target_preflight');
    await deps.claimAttempt({ runId, attemptId: attempt.id, date: attempt.day });
    check('single_attempt_claimed');
    for (const label of ['A', 'B', 'C']) {
      await timeFence();
      await preflight();
      const key = deps.uuid();
      requireCheck(UUID.test(key) && !fixtures.some(item => item.key === key), 'fixture_id_collision', 'aborted');
      const fixture = { label, key, email: `hosted-${key}@student.uc.pt`, password: deps.password(), attempted: true };
      fixtures.push(fixture);
      const publicFixture = { label, fixtureKey: key, userId: null, creation: 'attempted' };
      report.fixtures.push(publicFixture);
      // An interrupted/ambiguous request leaves a safe lookup marker, never a password.
      await deps.writeReport(report);
      const result = await admin.auth.admin.createUser({ email: fixture.email, password: fixture.password, email_confirm: true,
        user_metadata: { registration_name: `Hosted test ${label}`, birth_date: '2000-01-01', gender: 'undisclosed',
          adult: true, terms_version: '2.1', hosted_test_run: runId, hosted_test_fixture: key } });
      const user = result?.data?.user;
      if (ownership(user, fixture, runId)) { fixture.id = user.id; publicFixture.userId = user.id; publicFixture.creation = 'confirmed'; }
      else fixture.ambiguous = true;
      requireCheck(!result?.error && fixture.id, 'fixture_creation_unconfirmed', 'inconclusive');
    }
    check('three_fixtures_created', { count: fixtures.length });
    for (const fixture of fixtures) {
      fixture.client = makeClient(config.publishable);
      fixture.loginAttempted = true;
      const data = unwrap(await fixture.client.auth.signInWithPassword({ email: fixture.email, password: fixture.password }), 'fixture_login_failed');
      fixture.token = data?.session?.access_token;
      fixture.password = null;
      requireCheck(data?.user?.id === fixture.id && data?.session?.user?.id === fixture.id && fixture.token, 'fixture_login_identity_failed');
      await fixture.client.realtime.setAuth(fixture.token);
    }
    check('normal_password_login', { count: 3 });
    await timeFence(); await noRealParticipants();
    for (const fixture of fixtures.slice(0, 2)) fixture.intent = { p_intent: deps.uuid(), p_day: serverTime.day };
    const first = unwrap(await fixtures[0].client.rpc('find_or_join_match', fixtures[0].intent), 'match_failed');
    requireCheck(first?.status === 'waiting', 'unexpected_initial_match', 'aborted');
    await noRealParticipants();
    const second = pair(unwrap(await fixtures[1].client.rpc('find_or_join_match', fixtures[1].intent), 'match_failed'), 1);
    roomId = second.room_id; matchStarted = deps.monotonic();
    pair(unwrap(await fixtures[0].client.rpc('find_or_join_match', fixtures[0].intent), 'match_failed'), 0);
    check('fixture_pair_only');
    await observeSubscriptions();
    const message = await positive('server_delivery');
    const retried = unwrap(await fixtures[0].client.functions.invoke('send-message', { body: { roomId, message } }), 'retry_failed');
    requireCheck(retried?.success === true && retried.message?.id === message.id && retried.message.sender_id === fixtures[0].id,
      'retry_not_confirmed', 'inconclusive');
    for (const fixture of fixtures.slice(0, 2)) {
      const data = unwrap(await fixture.client.functions.invoke('get-room-messages', { body: { roomId } }), 'history_failed');
      requireCheck(data?.success === true && data.roomId === roomId && data.partial === true && Array.isArray(data.messages)
        && data.messages.length === 1 && data.messages[0].id === message.id && data.messages[0].sender_id === fixtures[0].id
        && data.messages[0].text === message.text,
      'retry_history_not_deduplicated');
    }
    check('redis_path_retry_history', { storedMessages: 1, readers: 2 });
    await negative('member_ws_no_delivery', async payload => {
      const before = httpBroadcasts;
      await fixtures[0].channel.send({ type: 'broadcast', event: 'message', payload }, { timeout: 5_000 });
      const codec = wsObserved.get(`realtime:room:${roomId}:${payload.id}`);
      requireCheck(codec && httpBroadcasts === before, 'websocket_transport_unconfirmed', 'inconclusive');
      return { transport: 'websocket_observed', codec };
    });
    for (const [label, fixture] of [['member', fixtures[0]], ['third', fixtures[2]], ['anonymous', null]]) {
      await negative(`${label}_rest_no_delivery`, async payload => {
        const response = await safeFetch(`${TARGET.url}/realtime/v1/api/broadcast`, {
          method: 'POST', headers: { apikey: config.publishable, 'Content-Type': 'application/json',
            ...(fixture ? { Authorization: `Bearer ${fixture.token}` } : {}) },
          body: JSON.stringify({ messages: [{ topic: `room:${roomId}`, event: 'message', payload, private: true }] }),
        });
        await response.body?.cancel();
        requireCheck(response.status < 500 && response.status !== 429, 'rest_attempt_unconfirmed', 'inconclusive');
        return { transport: 'rest', httpStatus: response.status };
      });
    }
    requireCheck(blockedIds.every(id => !receipts.A.has(id) && !receipts.B.has(id)), 'late_client_broadcast_delivered');
    ensureSubscriptions();
    requireCheck(receipts.C.size === 0, 'outsider_received_message');
    report.status = 'passed';
  } catch (error) {
    const failure = publicFailure(error);
    report.status = failure.status;
    report.checks.push({ name: 'execution_stopped', ...failure });
  } finally {
    cleaning = true;
    for (const { client, channel } of channels) {
      try { await client.removeChannel(channel); }
      catch { report.cleanup.push({ resource: 'channel', status: 'unconfirmed' }); }
    }
    // Reconcile only ambiguous attempts; bounded scans never delete by domain/prefix.
    for (const fixture of fixtures.filter(item => !item.id)) {
      fixture.ambiguous = true;
      try {
        for (let pass = 0; pass < 2 && !fixture.id; pass++) {
          if (pass) await deps.wait(500);
          for (let page = 1; page <= 5; page++) {
            const data = unwrap(await admin.auth.admin.listUsers({ page, perPage: 200 }), 'fixture_lookup_failed');
            requireCheck(Array.isArray(data?.users), 'fixture_lookup_failed');
            const matches = data.users.filter(user => ownership(user, fixture, runId));
            requireCheck(matches.length <= 1, 'fixture_lookup_ambiguous');
            if (matches[0]) { fixture.id = matches[0].id; break; }
            if (data.users.length < 200) break;
          }
        }
      } catch { /* A bounded unresolved lookup requires manual reconciliation. */ }
      if (!fixture.id) report.manualCleanupRequired = true;
      const item = report.fixtures.find(item => item.fixtureKey === fixture.key);
      item.userId = fixture.id ?? null;
      item.creation = fixture.id ? 'reconciled' : 'ambiguous_manual_lookup_required';
    }
    for (const fixture of fixtures) {
      fixture.password = null;
      const cleanup = { fixture: fixture.label, userId: fixture.id ?? null,
        revoked: fixture.loginAttempted ? 'unconfirmed' : 'not_needed', deleted: false };
      report.cleanup.push(cleanup);
      if (!fixture.id) continue;
      try {
        const user = unwrap(await admin.auth.admin.getUserById(fixture.id), 'cleanup_identity_unconfirmed')?.user;
        requireCheck(ownership(user, fixture, runId), 'cleanup_identity_mismatch');
        if (fixture.token) {
          cleanup.revoked = 'unconfirmed';
          const result = await admin.auth.admin.signOut(fixture.token, 'global');
          if (!result?.error) cleanup.revoked = 'confirmed';
        }
        const result = await admin.auth.admin.deleteUser(fixture.id);
        requireCheck(result && !result.error, 'cleanup_delete_unconfirmed');
        // Confirm absence rather than equating a successful HTTP response with deletion.
        const gone = await admin.auth.admin.getUserById(fixture.id);
        requireCheck(!gone?.data?.user && (gone?.error?.status === 404 || gone?.error?.code === 'user_not_found'), 'cleanup_delete_unconfirmed');
        cleanup.deleted = true;
      } catch { cleanup.status = 'manual_cleanup_required'; report.manualCleanupRequired = true; }
      if (cleanup.revoked === 'unconfirmed') report.manualCleanupRequired = true;
      fixture.token = null;
    }
    for (const client of clients) {
      try { client.realtime.disconnect(); await client.auth.dispose(); }
      catch { report.cleanup.push({ resource: 'client', status: 'unconfirmed' }); }
    }
    if (report.manualCleanupRequired && report.status === 'passed') report.status = 'inconclusive';
    await deps.writeReport(report);
  }
  return report;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.mode !== 'execute') { console.log(JSON.stringify(plan(selectAttempt(options.attemptId, options.date)), null, 2)); return; }
  // The ignored file is read only after the explicit execution flag.
  process.loadEnvFile(resolve('.env.hosted-test.local'));
  let interrupted = false;
  const interrupt = () => { interrupted = true; };
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  let report;
  try { report = await runHosted({ ...options, config: readConfig(process.env) }, { cancelled: () => interrupted }); }
  finally { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); }
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'passed') process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.log(JSON.stringify(publicFailure(error))); process.exitCode = 1; });
}
