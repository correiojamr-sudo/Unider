import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

const a = '00000000-0000-0000-0000-00000000000a';
const b = '00000000-0000-0000-0000-00000000000b';
const c = '00000000-0000-0000-0000-00000000000c';
const oldRoom = '00000000-0000-0000-0000-00000000000d';
const initialTime = '2026-10-02T21:30:00Z';
const clockSQL = "SELECT set_config('unider.test_now', $1, false)";
let clock = initialTime;
let db, pool;
const intents = new Map();
const intent = user => {
  if (!intents.has(user)) intents.set(user, randomUUID());
  return intents.get(user);
};
const newIntent = user => { const value = randomUUID(); intents.set(user, value); return value; };
const databaseUrl = process.env.UNIDER_TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  // Fixtures must NEVER run against a hosted Supabase or an existing app database.
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/unider_review') {
    throw new Error('Use only a disposable local database named unider_review');
  }
  pool = new pg.Pool({ connectionString: databaseUrl, max: 12 });
  db = { exec: sql => pool.query(sql), query: (sql, args) => pool.query(sql, args) };
} else db = new PGlite();

async function as(user, sql, params = [], role = 'authenticated') {
  const conn = pool ? await pool.connect() : db;
  try {
    await conn.query('BEGIN');
    await conn.query(`SET LOCAL ROLE ${role}`);
    await conn.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [user || '']);
    await conn.query(clockSQL, [clock]);
    const result = await conn.query(sql, params);
    await conn.query('COMMIT');
    return result.rows;
  } catch (error) { await conn.query('ROLLBACK'); throw error; }
  finally { if (pool) conn.release(); }
}
async function at(time) {
  clock = time;
  await db.query(clockSQL, [time]);
}
async function rpc(user, name, args = []) {
  if (name === 'find_or_join_match' && args.length === 0) args = [intent(user), clock.slice(0, 10)];
  return (await as(user, `SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) AS value`, args))[0].value;
}
async function denied(action) { await assert.rejects(action); }

test('PostgreSQL roles, consent, room lifecycle and account deletion', async t => {
  try {
    // Isolated Supabase-compatible schemas; cron scheduling and JWT verification
    // are stubs, not an end-to-end Supabase/Realtime test.
    await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth; CREATE SCHEMA realtime; CREATE SCHEMA cron;
      CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS
        'SELECT current_setting(''realtime.topic'', true)';
      CREATE TABLE realtime.messages(id uuid DEFAULT gen_random_uuid(), extension text);
      ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA public, auth, realtime TO anon, authenticated, service_role;
      GRANT SELECT, INSERT ON realtime.messages TO authenticated;
      CREATE POLICY broad_existing_policy ON realtime.messages TO authenticated USING (true) WITH CHECK (true);
      CREATE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE sql AS 'SELECT 1::bigint';
      CREATE FUNCTION public.test_now() RETURNS timestamptz LANGUAGE sql STABLE AS
        'SELECT coalesce(nullif(current_setting(''unider.test_now'', true), '''')::timestamptz, statement_timestamp())';
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    `);
    await db.exec(readFileSync('supabase/migrations/0001_initial_schema.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/0002_matchmaking_and_gdpr.sql', 'utf8')
      .replace('CREATE EXTENSION IF NOT EXISTS pg_cron;', ''));
    await at(initialTime);
    for (const [id, email] of [[a, 'a@student.uc.pt'], [b, 'b@student.uc.pt'], [c, 'c@student.uc.pt']]) {
      await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [id, email]);
    }
    await t.test('original bypass reproductions: queue/report and account FK', async () => {
      await as(c, 'INSERT INTO public.matchmaking_queue(user_id) VALUES($1)', [a]);
      await as(c, "INSERT INTO public.reported_chats(room_id,reporter_id,reported_id,transcript) VALUES('fake',$1,$2,'[]')", [c, a]);
      await denied(() => rpc(a, 'delete_own_user_account'));
      assert.equal((await db.query('SELECT count(*)::int AS n FROM public.profiles')).rows[0].n, 3);
    });
    await db.query('INSERT INTO public.active_rooms(id,user_a,user_b) VALUES($1,$2,$3)', [oldRoom, a, b]);
    // Inject ONLY the clock for deterministic Lisbon windows; production SQL remains unchanged.
    const patch = readFileSync('supabase/migrations/20261002231850_secure_chat_lifecycle.sql', 'utf8')
      .replace(/\bnow\(\)/g, 'public.test_now()');
    await db.exec(patch);

    await t.test('A01 original direct INSERT self-approves a suggestion before the new migration', async () => {
      await as(a, "INSERT INTO public.icebreaker_suggestions(user_id,suggestion,is_approved) VALUES($1,'Before fix self approval',true)", [a]);
      assert.equal((await as(b, "SELECT count(*)::int AS n FROM public.icebreaker_suggestions WHERE suggestion='Before fix self approval'"))[0].n, 1);
      // Broad per-column grants must also be revoked, not only table privileges.
      await db.exec('GRANT INSERT(id,user_id,suggestion,is_approved,created_at), UPDATE(id,user_id,suggestion,is_approved,created_at), REFERENCES(id,user_id,suggestion,is_approved,created_at) ON public.icebreaker_suggestions TO PUBLIC, anon, authenticated');
    });
    for (const filename of readdirSync('supabase/migrations').filter(name => name > '20261002231850_secure_chat_lifecycle.sql' && name.endsWith('.sql')).sort()) {
      await db.exec(readFileSync(`supabase/migrations/${filename}`, 'utf8').replace(/\bnow\(\)/g, 'public.test_now()'));
    }

    await t.test('A01 approval is admin-only across INSERT, NULL, upsert and inherited column grants', async () => {
      for (const approval of [true, false, null]) {
        await denied(() => as(a, 'INSERT INTO public.icebreaker_suggestions(user_id,suggestion,is_approved) VALUES($1,$2,$3)', [a, 'Forbidden approval field', approval]));
      }
      await denied(() => as(a, "INSERT INTO public.icebreaker_suggestions(user_id,suggestion) VALUES($1,'Forbidden impersonation')", [b]));
      await denied(() => as(null, "INSERT INTO public.icebreaker_suggestions(user_id,suggestion) VALUES($1,'Anonymous insert')", [a], 'anon'));
      await denied(() => as(a, "INSERT INTO public.icebreaker_suggestions(user_id,suggestion) VALUES($1,'Upsert new row') ON CONFLICT(id) DO UPDATE SET suggestion=excluded.suggestion", [a]));
      await denied(() => as(a, 'UPDATE public.icebreaker_suggestions SET is_approved=true'));
      await as(a, "INSERT INTO public.icebreaker_suggestions(user_id,suggestion) VALUES($1,'Ordinary pending suggestion')", [a]);
      assert.equal((await as(b, "SELECT count(*)::int AS n FROM public.icebreaker_suggestions WHERE suggestion='Ordinary pending suggestion'"))[0].n, 0);
      const row = (await db.query("SELECT id,is_approved FROM public.icebreaker_suggestions WHERE suggestion='Ordinary pending suggestion'")).rows[0];
      assert.equal(row.is_approved, false);
      await as(null, 'UPDATE public.icebreaker_suggestions SET is_approved=true WHERE id=$1', [row.id], 'service_role');
      assert.equal((await as(b, 'SELECT count(*)::int AS n FROM public.icebreaker_suggestions WHERE id=$1', [row.id]))[0].n, 1);
      await as(null, "INSERT INTO public.icebreaker_suggestions(suggestion,is_approved) VALUES('Administrative suggestion',true)", [], 'service_role');
      for (const role of ['anon', 'authenticated']) {
        for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
          const allowed = (await db.query("SELECT has_table_privilege($1, 'public.icebreaker_suggestions', $2) AS allowed", [role, privilege])).rows[0].allowed;
          assert.equal(allowed, false, `${role} table ${privilege}`);
        }
        for (const column of ['id', 'user_id', 'suggestion', 'is_approved', 'created_at']) for (const privilege of ['INSERT', 'UPDATE', 'REFERENCES']) {
          const allowed = (await db.query("SELECT has_column_privilege($1, 'public.icebreaker_suggestions', $2, $3) AS allowed", [role, column, privilege])).rows[0].allowed;
          assert.equal(allowed, role === 'authenticated' && privilege === 'INSERT' && ['user_id', 'suggestion'].includes(column), `${role} ${column} ${privilege}`);
        }
      }
    });

    await t.test('fixed direct routes forbidden; service helper inaccessible to clients', async () => {
      await denied(() => as(c, 'INSERT INTO public.matchmaking_queue(user_id) VALUES($1)', [b]));
      await denied(() => as(c, "INSERT INTO public.reported_chats(room_id,reporter_id,reported_id,transcript) VALUES('fake',$1,$2,'[]')", [c, a]));
      await denied(() => as(a, 'UPDATE public.profiles SET is_banned=false WHERE id=$1', [a]));
      await denied(() => rpc(a, 'authorize_room', [oldRoom, a, 'message']));
      await denied(() => rpc(a, 'persist_room_report', [oldRoom, a, []]));
      await denied(() => as(null, 'SELECT public.find_or_join_match()', [], 'anon'));
      await denied(() => rpc(a, 'purge_old_reports'));
      assert.equal((await db.query('SELECT ended_at IS NOT NULL AS closed FROM public.active_rooms WHERE id=$1', [oldRoom])).rows[0].closed, true);
    });

    await t.test('consent persists only the current version; bans prevent consent and matching', async () => {
      await denied(() => rpc(a, 'find_or_join_match'));
      await denied(() => rpc(a, 'accept_terms', ['1.0']));
      for (const user of [a, b, c]) assert.equal(await rpc(user, 'accept_terms', ['1.1']), true);
      await db.query('UPDATE public.profiles SET is_banned=true WHERE id=$1', [c]);
      await denied(() => rpc(c, 'accept_terms', ['1.1']));
      await denied(() => rpc(c, 'find_or_join_match'));
      await db.query('UPDATE public.profiles SET is_banned=false WHERE id=$1', [c]);
    });

    let room;
    await t.test('match polling reconciles without subscription; existing room restores same deadline', async () => {
      assert.equal((await rpc(a, 'find_or_join_match')).status, 'waiting');
      const joined = (await db.query('SELECT joined_at FROM public.matchmaking_queue WHERE user_id=$1', [a])).rows[0].joined_at;
      await rpc(a, 'find_or_join_match');
      assert.equal(String((await db.query('SELECT joined_at FROM public.matchmaking_queue WHERE user_id=$1', [a])).rows[0].joined_at), String(joined));
      room = await rpc(b, 'find_or_join_match');
      assert.equal(room.peer_id, a);
      const restored = await rpc(a, 'find_or_join_match');
      assert.equal(restored.room_id, room.room_id); assert.equal(restored.expires_at, room.expires_at);
      await denied(() => rpc(c, 'get_room_state', [room.room_id]));
      const authorized = await as(a, 'SELECT public.authorize_room($1,$2,$3) AS value', [room.room_id, a, 'message'], 'service_role');
      assert.equal(authorized[0].value.peer_id, b);
      await denied(() => as(c, 'SELECT public.authorize_room($1,$2,$3)', [room.room_id, c, 'report'], 'service_role'));
    });

    await t.test('private read policy and restrictive INSERT guard withstand a broad pre-existing policy', async () => {
      const allow = await rpc(a, 'can_receive_room_broadcast', ['room:' + room.room_id]);
      assert.equal(allow, true);
      assert.equal(await rpc(c, 'can_receive_room_broadcast', ['room:' + room.room_id]), false);
      await denied(() => as(a, "WITH topic AS (SELECT set_config('realtime.topic',$1,true)) INSERT INTO realtime.messages(extension) SELECT 'broadcast' FROM topic", ['room:' + room.room_id]));
    });

    await t.test('decision phase, both extension votes, refresh and ban enforcement', async () => {
      await at('2026-10-02T21:32:00Z');
      await db.query('UPDATE public.active_rooms SET heartbeat_a=public.test_now(),heartbeat_b=public.test_now() WHERE id=$1', [room.room_id]);
      await denied(() => as(a, 'SELECT public.authorize_room($1,$2,$3)', [room.room_id, a, 'message'], 'service_role'));
      assert.equal((await rpc(a, 'extend_room', [room.room_id])).extended_once, false);
      const extended = await rpc(b, 'extend_room', [room.room_id]);
      assert.equal(extended.extended_once, true);
      assert.equal(Date.parse(extended.expires_at) - Date.parse(extended.server_now), 180000);
      assert.equal((await rpc(a, 'get_room_state', [room.room_id])).expires_at, extended.expires_at);
      await denied(() => rpc(a, 'extend_room', [room.room_id]));
      await db.query('UPDATE public.profiles SET is_banned=true WHERE id=$1', [b]);
      await denied(() => as(b, 'SELECT public.authorize_room($1,$2,$3)', [room.room_id, b, 'message'], 'service_role'));
      assert.equal((await rpc(a, 'get_room_state', [room.room_id])).end_reason, 'account_unavailable');
      await db.query('UPDATE public.profiles SET is_banned=false WHERE id=$1', [b]);
    });

    await t.test('closed room no longer traps new chat; heartbeat expiry and lease pruning', async () => {
      newIntent(a);
      assert.equal((await rpc(a, 'find_or_join_match')).status, 'waiting');
      const second = await rpc(c, 'find_or_join_match');
      assert.notEqual(second.room_id, room.room_id);
      await at('2026-10-02T21:32:46Z');
      assert.equal((await rpc(a, 'get_room_state', [second.room_id])).end_reason, 'disconnect');
      newIntent(a); newIntent(b);
      await rpc(a, 'find_or_join_match');
      await at('2026-10-02T21:33:02Z');
      assert.equal((await rpc(b, 'find_or_join_match')).status, 'waiting');
      assert.equal((await db.query('SELECT count(*)::int AS n FROM public.matchmaking_queue WHERE user_id=$1', [a])).rows[0].n, 0);
    });

    await t.test('outside session and after 22:48 cutoff denied on server', async () => {
      newIntent(c);
      await at('2026-10-02T21:48:01Z');
      assert.equal((await rpc(c, 'find_or_join_match')).status, 'closed');
      await at('2026-10-02T20:00:00Z');
      assert.equal((await rpc(c, 'find_or_join_match')).status, 'closed');
    });

    await t.test('A02 cancellation wins before/after matching, new intent stays independent, and room leave is terminal', async () => {
      await at(initialTime);
      await db.query('UPDATE public.active_rooms SET ended_at=public.test_now() WHERE ended_at IS NULL');
      await db.query('DELETE FROM public.matchmaking_queue');
      const day = '2026-10-02', cancelled = randomUUID();
      await rpc(a, 'leave_matchmaking', [cancelled, day]);
      assert.equal((await rpc(a, 'find_or_join_match', [cancelled, day])).status, 'cancelled');
      assert.equal((await db.query('SELECT count(*)::int AS n FROM public.matchmaking_queue WHERE user_id=$1', [a])).rows[0].n, 0);

      const firstIntent = newIntent(a); newIntent(b);
      assert.equal((await rpc(a, 'find_or_join_match')).status, 'waiting');
      const firstRoom = await rpc(b, 'find_or_join_match');
      await rpc(a, 'leave_matchmaking', [firstIntent, day]);
      assert.equal((await rpc(a, 'find_or_join_match', [firstIntent, day])).status, 'cancelled');
      assert.ok((await rpc(b, 'get_room_state', [firstRoom.room_id])).ended_at);
      assert.equal((await rpc(b, 'find_or_join_match')).status, 'cancelled', 'Cancellation is terminal for both room intentions');

      newIntent(a); newIntent(c);
      await rpc(a, 'find_or_join_match');
      const nextRoom = await rpc(c, 'find_or_join_match');
      await rpc(a, 'leave_matchmaking', [firstIntent, day]);
      assert.equal((await rpc(a, 'get_room_state', [nextRoom.room_id])).ended_at, null, 'Old cancellation cannot close a new intent room');
      await rpc(a, 'leave_room', [nextRoom.room_id]);
      assert.equal((await rpc(a, 'find_or_join_match')).status, 'cancelled', 'Late find after room exit is terminal too');
      await denied(() => as(a, 'SELECT * FROM unider_private.matchmaking_intents'));
      await denied(() => as(a, 'SELECT public.find_or_join_match()'));
      await denied(() => as(a, 'SELECT public.leave_matchmaking()'));
    });

    await t.test('A04 missing room leave is idempotent, but an existing outsider room remains denied', async () => {
      newIntent(b); newIntent(c);
      await rpc(b, 'find_or_join_match');
      const existing = await rpc(c, 'find_or_join_match');
      await denied(() => rpc(a, 'leave_room', [existing.room_id]));
      assert.equal((await rpc(b, 'get_room_state', [existing.room_id])).ended_at, null);
      const purged = randomUUID();
      await assert.doesNotReject(() => rpc(a, 'leave_room', [purged]));
      await assert.doesNotReject(() => rpc(a, 'leave_room', [purged]));
      await denied(() => as(null, 'SELECT public.leave_room($1)', [purged], 'anon'));
      await rpc(b, 'leave_room', [existing.room_id]);
    });

    await t.test('A02 tombstones expire only when server day already rejects every old intent', async () => {
      await at('2026-10-04T21:30:00Z');
      await db.query('SELECT public.purge_old_reports()');
      assert.equal((await db.query("SELECT count(*)::int AS n FROM unider_private.matchmaking_intents WHERE intent_day='2026-10-02'")).rows[0].n, 0);
      assert.equal((await rpc(a, 'find_or_join_match', [intent(a), '2026-10-02'])).status, 'closed');
      assert.equal((await db.query('SELECT count(*)::int AS n FROM public.matchmaking_queue WHERE user_id=$1', [a])).rows[0].n, 0);
      await at(initialTime);
    });

    await t.test('deletion succeeds with retained reports, deleted JWT loses authority', async () => {
      await rpc(a, 'delete_own_user_account');
      assert.equal((await db.query("SELECT reported_id FROM public.reported_chats WHERE room_id='fake'")).rows[0].reported_id, null);
      await denied(() => rpc(a, 'accept_terms', ['1.1']));
      await denied(() => rpc(a, 'find_or_join_match'));
      assert.equal((await db.query('SELECT count(*)::int AS n FROM auth.users WHERE id=$1', [a])).rows[0].n, 0);
    });

    await t.test('peer deletion between report authorization and persistence preserves the survivor evidence', async () => {
      await at(initialTime);
      await db.query('UPDATE public.active_rooms SET ended_at=public.test_now() WHERE ended_at IS NULL');
      await db.query('DELETE FROM public.matchmaking_queue');
      newIntent(b); newIntent(c);
      await rpc(b, 'find_or_join_match');
      const fresh = await rpc(c, 'find_or_join_match');
      await as(b, 'SELECT public.authorize_room($1,$2,$3)', [fresh.room_id, b, 'report'], 'service_role');
      await rpc(c, 'delete_own_user_account');
      const evidence = [{ sender: 'reported', text: 'available evidence' }];
      const saved = await as(b, 'SELECT public.persist_room_report($1,$2,$3) AS id', [fresh.room_id, b, JSON.stringify(evidence)], 'service_role');
      const row = (await db.query('SELECT reported_id,transcript FROM public.reported_chats WHERE id=$1', [saved[0].id])).rows[0];
      assert.equal(row.reported_id, null);
      assert.deepEqual(row.transcript, evidence);
      await as(b, 'SELECT public.persist_room_report($1,$2,$3)', [fresh.room_id, b, '[]'], 'service_role');
      assert.deepEqual((await db.query('SELECT transcript FROM public.reported_chats WHERE id=$1', [saved[0].id])).rows[0].transcript, evidence);
      // Restore a disposable fixture for the independent concurrency scenario.
      await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [c, 'c@student.uc.pt']);
      await rpc(c, 'accept_terms', ['1.1']);
    });

    await t.test('actual concurrent PostgreSQL transactions preserve one open room per user',
      { skip: !pool && 'PGlite is single-connection; CI uses PostgreSQL 17 for this test' }, async () => {
        await at(initialTime);
        await db.query('UPDATE public.active_rooms SET ended_at=public.test_now() WHERE ended_at IS NULL');
        await db.query('DELETE FROM public.matchmaking_queue');
        newIntent(b); newIntent(c);
        await rpc(b, 'find_or_join_match');
        await Promise.all(Array.from({ length: 32 }, (_, i) => rpc(i % 2 ? b : c, 'find_or_join_match')));
        const rows = (await db.query(`SELECT user_id, count(*)::int AS n FROM (
          SELECT user_a AS user_id FROM public.active_rooms WHERE ended_at IS NULL
          UNION ALL SELECT user_b FROM public.active_rooms WHERE ended_at IS NULL
        ) members GROUP BY user_id HAVING count(*) > 1`)).rows;
        assert.equal(rows.length, 0);
      });

    await t.test('A02 actual concurrent PostgreSQL cancellation fences delayed find and peer matching',
      { skip: !pool && 'PGlite is single-connection; PostgreSQL proves the overlapping transactions' }, async () => {
        await at(initialTime);
        for (let attempt = 0; attempt < 12; attempt++) {
          await db.query('UPDATE public.active_rooms SET ended_at=public.test_now() WHERE ended_at IS NULL');
          await db.query('DELETE FROM public.matchmaking_queue');
          const target = newIntent(b); newIntent(c);
          if (attempt % 2) await rpc(b, 'find_or_join_match');
          const actions = [() => rpc(b, 'leave_matchmaking', [target, '2026-10-02']),
            () => rpc(b, 'find_or_join_match'), () => rpc(c, 'find_or_join_match')];
          if (attempt % 3) actions.reverse();
          await Promise.all(actions.map(run => run()));
          assert.equal((await rpc(b, 'find_or_join_match')).status, 'cancelled');
          assert.equal((await db.query('SELECT count(*)::int AS n FROM public.active_rooms WHERE ended_at IS NULL AND $1 IN (user_a,user_b)', [b])).rows[0].n, 0);
          assert.equal((await db.query('SELECT count(*)::int AS n FROM public.matchmaking_queue WHERE user_id=$1', [b])).rows[0].n, 0);
        }
      });
  } finally { if (pool) await pool.end(); else await db.close(); }
});
