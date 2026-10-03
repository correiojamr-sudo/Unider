# Review fixes: deployment and validation

This PR does not alter Cloudflare Workers. The frontend remains a Cloudflare Pages
application. No hosted Supabase configuration/database has been changed by this PR.

## Deploy together

1. Review/back up the database, then apply
   `supabase/migrations/20261002231850_secure_chat_lifecycle.sql` in staging first.
   It closes pre-migration rooms, preserves reports, replaces RPCs and tightens grants.
2. Deploy both Supabase Edge Functions (`send-message`, `report-room`), including
   their `_shared` directory. Keep JWT verification enabled. Configure
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` as server-side secrets;
   Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Verify private-channel authorization with the checklist below, then deploy Pages.
   Existing users must accept terms version 1.1 before matching again.

Do not release the old frontend/Edge Functions alongside the new database contract.
Use a maintenance window: database first, Functions second, Pages third. To recover
from a faulty release, disable matching and fix forward; restoring the insecure
grants/public message route is not a safe rollback. Historical migrations are unchanged.

## Security and lifecycle contracts

- Queue writes and reports cannot be submitted directly by clients. Consent is a
  current-version RPC with a server timestamp; clients cannot change `is_banned`.
- Every sensitive operation checks a present, non-banned, consented profile.
  Edge Functions derive the identity from the verified JWT and check room membership.
- `room:<uuid>` channels are private and read-only to members. Only the server
  publishes chat messages. Extension/leave actions use authenticated RPCs.
  Restrictive Realtime policies protect these topics even alongside a broad existing
  permissive policy. Do not add client broadcast INSERT permission for room topics.
- Matchmaking is transaction-serialized with one advisory lock for this pilot.
  Queue leases last 15 seconds; polling every 3 seconds renews them without losing
  queue age. This polling also recovers matches without a database subscription event
  or a `supabase_realtime` publication change.
- Server time in Europe/Lisbon allows new matches from 22:30 until **before** 22:48.
  Conversations last two minutes, with a 30-second extension decision window and
  at most one mutual three-minute extension, capped at 22:50. Refresh never renews
  the deadline. A missed participant heartbeat closes the room after 45 seconds.
- The shared Redis lease serializes send/report. Atomic, fenced append deduplicates
  the sender/message ID; a room permits at most 200 messages of 2,000 characters.
  A delivery failure is shown and can be retried with the same ID. The buffer is
  ephemeral, with a 300-second TTL following an accepted new message. Dedup/quota
  metadata (hashes, IDs and timestamps, not plaintext) lasts 600 seconds, covering
  the full extended room lifetime even if the transcript buffer expires first.
- Reporting freezes the room, persists once per reporter, derives the peer, and
  leaves the temporary buffer intact for retries/the other reporter until TTL.
  If persistence fails, the UI stays in the room and permits retrying the report.
- Account deletion removes auth/profile/queue records and closes conversations.
  Pseudonymous room membership remains until one day after the session's hard close,
  so peer deletion cannot prevent a survivor from reporting in the five-minute window.
  Report profile links
  become NULL rather than blocking deletion. New transcripts use participant roles
  rather than UUIDs; old reports and message text may retain identifying information.
  Reporter idempotency keys are cleared when that reporter deletes their account.
  Reports become eligible for removal at 30 days; cleanup runs every five minutes.
  Monitor `cron.job_run_details`: failed cleanup may exceed this operational target.

## Automated checks

`npm ci`, `npm test`, `npm run lint`, `npm run build`.

Tests execute the real TypeScript handlers/state helpers with injected dependencies.
Database tests apply the original migrations and reproduce the old direct-write/FK
failures before applying the fix. They then exercise real PostgreSQL roles, policies,
RPCs, expiry, consent, bans, leases, refresh and account deletion. The SQL clock is
injected only inside the isolated test fixture to make Lisbon time windows deterministic.

Default local database tests use PGlite; its single connection **does not verify
concurrent transactions**. CI uses PostgreSQL 17 and additionally races 32 matching
requests. To run that locally, use a fresh disposable local PostgreSQL database named
`unider_review`, with a superuser connection in `UNIDER_TEST_DATABASE_URL`.
The harness refuses non-local hosts/other database names, and intentionally fails
if fixtures already exist. Never point it at a real app database.

Auth JWT lookup and cron scheduling in the database fixture are stubs. Redis and
Realtime calls in handler tests are mocks. These are regression tests, not proof of
the hosted Realtime/Upstash configuration. The Edge type-check runs independently in CI.

## Required staging checks before marking ready

- With two members and a third authenticated user, prove private room subscribe/read
  succeeds for members and fails for the outsider. Prove member/outsider direct
  WebSocket **and REST** broadcasts fail; server private REST broadcast succeeds.
- Exercise real Upstash Lua append/dedup and lock release; retry a failed delivery,
  simultaneous send/report, two reports, and database-insert failure. Evidence must
  remain available for retry and never be overwritten with an empty transcript.
- Use two browsers to test OTP, re-accepting terms, new chat, reload, both extension
  votes, a closed tab, lost connection/reconnection and the 22:48/22:50 boundaries.
- Ban a live participant and delete an account with existing reports. Verify denied
  server operations, successful deletion, retained evidence policy and cron cleanup.

Until these environment checks pass, keep the PR in draft. Applying migrations and
deploying Functions/Pages is a separate operator action, not something this PR performs.
