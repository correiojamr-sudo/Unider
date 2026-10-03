import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
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
      assert.equal((await rpc(a, 'find_or_join_match')).status, 'waiting');
      const second = await rpc(c, 'find_or_join_match');
      assert.notEqual(second.room_id, room.room_id);
      await at('2026-10-02T21:32:46Z');
      assert.equal((await rpc(a, 'get_room_state', [second.room_id])).end_reason, 'disconnect');
      await rpc(a, 'find_or_join_match');
      await at('2026-10-02T21:33:02Z');
      assert.equal((await rpc(b, 'find_or_join_match')).status, 'waiting');
      assert.equal((await db.query('SELECT count(*)::int AS n FROM public.matchmaking_queue WHERE user_id=$1', [a])).rows[0].n, 0);
    });

    await t.test('outside session and after 22:48 cutoff denied on server', async () => {
      await at('2026-10-02T21:48:01Z');
      assert.equal((await rpc(c, 'find_or_join_match')).status, 'closed');
      await at('2026-10-02T20:00:00Z');
      assert.equal((await rpc(c, 'find_or_join_match')).status, 'closed');
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
        await rpc(b, 'find_or_join_match');
        await Promise.all(Array.from({ length: 32 }, (_, i) => rpc(i % 2 ? b : c, 'find_or_join_match')));
        const rows = (await db.query(`SELECT user_id, count(*)::int AS n FROM (
          SELECT user_a AS user_id FROM public.active_rooms WHERE ended_at IS NULL
          UNION ALL SELECT user_b FROM public.active_rooms WHERE ended_at IS NULL
        ) members GROUP BY user_id HAVING count(*) > 1`)).rows;
        assert.equal(rows.length, 0);
      });
  } finally { if (pool) await pool.end(); else await db.close(); }
});
