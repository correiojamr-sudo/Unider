-- Apply before deploying the matching Edge Functions/frontend. No Workers changes.
BEGIN;
CREATE SCHEMA IF NOT EXISTS unider_private;
REVOKE ALL ON SCHEMA unider_private FROM PUBLIC, anon, authenticated;

ALTER TABLE public.matchmaking_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.matchmaking_queue FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.active_rooms FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.reported_chats FROM anon, authenticated;
DROP POLICY IF EXISTS "Inserção de denúncia" ON public.reported_chats;
-- Consent is changed only through accept_terms, never by granting profile UPDATE.
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM anon, authenticated;

ALTER TABLE public.matchmaking_queue ADD COLUMN lease_until timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.active_rooms
  -- Preserve pseudonymous membership during the survivor's reporting window.
  DROP CONSTRAINT active_rooms_user_a_fkey,
  DROP CONSTRAINT active_rooms_user_b_fkey,
  ADD COLUMN expires_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN hard_close_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN ended_at timestamptz,
  ADD COLUMN end_reason text,
  ADD COLUMN extended_once boolean NOT NULL DEFAULT false,
  ADD COLUMN extend_a boolean NOT NULL DEFAULT false,
  ADD COLUMN extend_b boolean NOT NULL DEFAULT false,
  ADD COLUMN heartbeat_a timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN heartbeat_b timestamptz NOT NULL DEFAULT now();
-- Existing rows have no reliable lifecycle: close them, do not restore stale pairs.
UPDATE public.active_rooms SET ended_at = now(), end_reason = 'migration';
CREATE INDEX active_rooms_open_a ON public.active_rooms(user_a) WHERE ended_at IS NULL;
CREATE INDEX active_rooms_open_b ON public.active_rooms(user_b) WHERE ended_at IS NULL;
CREATE INDEX matchmaking_queue_age ON public.matchmaking_queue(joined_at);

ALTER TABLE public.reported_chats
  ALTER COLUMN reporter_id DROP NOT NULL,
  ALTER COLUMN reported_id DROP NOT NULL,
  DROP CONSTRAINT reported_chats_reporter_id_fkey,
  DROP CONSTRAINT reported_chats_reported_id_fkey,
  ADD CONSTRAINT reported_chats_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD CONSTRAINT reported_chats_reported_id_fkey FOREIGN KEY (reported_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN request_key text UNIQUE;

CREATE FUNCTION unider_private.eligible(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user
    AND is_banned IS FALSE AND terms_version = '1.1' AND terms_accepted_at IS NOT NULL);
$$;

CREATE FUNCTION public.accept_terms(p_version text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR p_version IS DISTINCT FROM '1.1' THEN
    RAISE EXCEPTION 'Invalid consent' USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles SET terms_version = p_version, terms_accepted_at = now()
    WHERE id = auth.uid() AND is_banned IS FALSE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account unavailable' USING ERRCODE = '42501'; END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION unider_private.refresh_room(p_room uuid) RETURNS public.active_rooms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.active_rooms;
BEGIN
  SELECT * INTO r FROM public.active_rooms WHERE id = p_room FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room unavailable' USING ERRCODE = '42501'; END IF;
  IF r.ended_at IS NULL THEN
    IF NOT unider_private.eligible(r.user_a) OR NOT unider_private.eligible(r.user_b) THEN
      r.end_reason := 'account_unavailable';
    ELSIF now() >= r.hard_close_at OR now() >= r.expires_at + (CASE WHEN r.extended_once THEN interval '0 seconds' ELSE interval '30 seconds' END) THEN
      r.end_reason := 'timeout';
    ELSIF least(r.heartbeat_a, r.heartbeat_b) < now() - interval '45 seconds' THEN
      r.end_reason := 'disconnect';
    END IF;
    IF r.end_reason IS NOT NULL THEN
      UPDATE public.active_rooms SET ended_at = now(), end_reason = r.end_reason
        WHERE id = p_room RETURNING * INTO r;
    END IF;
  END IF;
  RETURN r;
END;
$$;

CREATE FUNCTION unider_private.room_json(r public.active_rooms, p_user uuid) RETURNS json
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT json_build_object('status', 'matched', 'room_id', r.id,
    'peer_id', CASE WHEN r.user_a = p_user THEN r.user_b ELSE r.user_a END,
    'expires_at', r.expires_at, 'hard_close_at', r.hard_close_at,
    'decision_until', least(r.hard_close_at, r.expires_at + CASE WHEN r.extended_once THEN interval '0 seconds' ELSE interval '30 seconds' END),
    'ended_at', r.ended_at, 'end_reason', r.end_reason, 'extended_once', r.extended_once,
    'extended', CASE WHEN r.user_a = p_user THEN r.extend_a ELSE r.extend_b END,
    'peer_extended', CASE WHEN r.user_a = p_user THEN r.extend_b ELSE r.extend_a END,
    'server_now', now());
$$;

CREATE OR REPLACE FUNCTION public.find_or_join_match() RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := auth.uid(); peer uuid; r public.active_rooms;
  local_time timestamp := now() AT TIME ZONE 'Europe/Lisbon'; close_at timestamptz;
BEGIN
  IF NOT unider_private.eligible(caller) THEN RAISE EXCEPTION 'Account or consent unavailable' USING ERRCODE = '42501'; END IF;
  -- One global transaction lock prevents a caller being selected as a peer while
  -- its own request creates a second room. Keep until a normalized membership model.
  PERFORM pg_advisory_xact_lock(74190231);
  FOR r IN SELECT * FROM public.active_rooms WHERE ended_at IS NULL AND (user_a = caller OR user_b = caller) LOOP
    r := unider_private.refresh_room(r.id);
    IF r.ended_at IS NULL THEN RETURN unider_private.room_json(r, caller); END IF;
  END LOOP;
  IF local_time::time < time '22:30' OR local_time::time >= time '22:48' THEN
    DELETE FROM public.matchmaking_queue WHERE user_id = caller;
    RETURN json_build_object('status', 'closed', 'server_now', now());
  END IF;
  close_at := (local_time::date + time '22:50') AT TIME ZONE 'Europe/Lisbon';
  -- Recover abandoned rooms before selecting a candidate; leases survive refresh.
  FOR r IN SELECT * FROM public.active_rooms WHERE ended_at IS NULL LOOP
    PERFORM unider_private.refresh_room(r.id);
  END LOOP;
  DELETE FROM public.matchmaking_queue q WHERE lease_until <= now()
    OR NOT unider_private.eligible(q.user_id)
    OR EXISTS (SELECT 1 FROM public.active_rooms a WHERE a.ended_at IS NULL AND q.user_id IN (a.user_a, a.user_b));
  SELECT user_id INTO peer FROM public.matchmaking_queue
    WHERE user_id <> caller ORDER BY joined_at, user_id LIMIT 1;
  IF peer IS NOT NULL THEN
    DELETE FROM public.matchmaking_queue WHERE user_id IN (caller, peer);
    INSERT INTO public.active_rooms(user_a, user_b, expires_at, hard_close_at)
      VALUES(caller, peer, least(now() + interval '2 minutes', close_at), close_at) RETURNING * INTO r;
    RETURN unider_private.room_json(r, caller);
  END IF;
  INSERT INTO public.matchmaking_queue(user_id, lease_until) VALUES(caller, now() + interval '15 seconds')
    ON CONFLICT(user_id) DO UPDATE SET lease_until = excluded.lease_until;
  RETURN json_build_object('status', 'waiting', 'server_now', now());
END;
$$;

CREATE FUNCTION public.get_room_state(p_room uuid) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.active_rooms; caller uuid := auth.uid();
BEGIN
  IF NOT unider_private.eligible(caller) OR NOT EXISTS
    (SELECT 1 FROM public.active_rooms WHERE id = p_room AND caller IN (user_a, user_b)) THEN
    RAISE EXCEPTION 'Room unavailable' USING ERRCODE = '42501';
  END IF;
  r := unider_private.refresh_room(p_room);
  IF r.ended_at IS NULL THEN
    UPDATE public.active_rooms SET heartbeat_a = CASE WHEN user_a = caller THEN now() ELSE heartbeat_a END,
      heartbeat_b = CASE WHEN user_b = caller THEN now() ELSE heartbeat_b END WHERE id = p_room RETURNING * INTO r;
  END IF;
  RETURN unider_private.room_json(r, caller);
END;
$$;

CREATE FUNCTION public.extend_room(p_room uuid) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.active_rooms; caller uuid := auth.uid();
BEGIN
  -- Also verifies membership and renews the caller's heartbeat.
  PERFORM public.get_room_state(p_room);
  SELECT * INTO r FROM public.active_rooms WHERE id = p_room FOR UPDATE;
  IF r.ended_at IS NOT NULL OR r.extended_once OR now() < r.expires_at OR now() >= r.hard_close_at THEN
    RAISE EXCEPTION 'Extension unavailable';
  END IF;
  r.extend_a := r.extend_a OR r.user_a = caller;
  r.extend_b := r.extend_b OR r.user_b = caller;
  IF r.extend_a AND r.extend_b THEN
    r.expires_at := least(now() + interval '3 minutes', r.hard_close_at);
    r.extended_once := true;
  END IF;
  UPDATE public.active_rooms SET extend_a = r.extend_a, extend_b = r.extend_b,
    expires_at = r.expires_at, extended_once = r.extended_once WHERE id = p_room RETURNING * INTO r;
  RETURN unider_private.room_json(r, caller);
END;
$$;

CREATE FUNCTION public.leave_room(p_room uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  UPDATE public.active_rooms SET ended_at = coalesce(ended_at, now()), end_reason = coalesce(end_reason, 'disconnect')
    WHERE id = p_room AND auth.uid() IN (user_a, user_b);
  IF NOT FOUND THEN RAISE EXCEPTION 'Room unavailable' USING ERRCODE = '42501'; END IF;
END;
$$;

-- Service-only: the verified JWT subject, never a user ID taken from request JSON.
CREATE FUNCTION public.authorize_room(p_room uuid, p_user uuid, p_operation text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.active_rooms;
BEGIN
  IF NOT unider_private.eligible(p_user) OR NOT EXISTS
    (SELECT 1 FROM public.active_rooms WHERE id = p_room AND p_user IN (user_a, user_b)) THEN
    RAISE EXCEPTION 'Room unavailable' USING ERRCODE = '42501';
  END IF;
  r := unider_private.refresh_room(p_room);
  IF p_operation = 'message' THEN
    IF r.ended_at IS NOT NULL OR now() >= r.expires_at THEN RAISE EXCEPTION 'Room closed' USING ERRCODE = '42501'; END IF;
  ELSIF p_operation = 'report' THEN
    IF now() > least(r.hard_close_at, coalesce(r.ended_at, r.expires_at)) + interval '5 minutes' THEN
      RAISE EXCEPTION 'Report window expired' USING ERRCODE = '42501';
    END IF;
    UPDATE public.active_rooms SET ended_at = coalesce(ended_at, now()), end_reason = coalesce(end_reason, 'report')
      WHERE id = p_room RETURNING * INTO r;
  ELSE RAISE EXCEPTION 'Invalid operation';
  END IF;
  RETURN unider_private.room_json(r, p_user);
END;
$$;

CREATE FUNCTION public.can_receive_room_broadcast(p_topic text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT unider_private.eligible(auth.uid()) AND EXISTS (
    SELECT 1 FROM public.active_rooms r WHERE p_topic = 'room:' || r.id::text
      AND auth.uid() IN (r.user_a, r.user_b) AND r.ended_at IS NULL
      AND now() < r.hard_close_at AND now() < r.expires_at + interval '30 seconds'
      AND unider_private.eligible(r.user_a) AND unider_private.eligible(r.user_b));
$$;
-- Realtime already owns/enables RLS. Do NOT ALTER realtime.messages here.
CREATE FUNCTION public.persist_room_report(p_room uuid, p_user uuid, p_transcript jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.active_rooms; peer uuid; report_id uuid;
BEGIN
  -- Revalidate and persist atomically with profile deletion. Membership remains
  -- available even if the peer deletes its profile while Redis is being read.
  PERFORM public.authorize_room(p_room, p_user, 'report');
  SELECT * INTO r FROM public.active_rooms WHERE id = p_room FOR UPDATE;
  peer := CASE WHEN r.user_a = p_user THEN r.user_b ELSE r.user_a END;
  PERFORM id FROM public.profiles WHERE id IN (p_user, peer) ORDER BY id FOR KEY SHARE;
  IF NOT unider_private.eligible(p_user) THEN RAISE EXCEPTION 'Account unavailable' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = peer) THEN peer := NULL; END IF;
  INSERT INTO public.reported_chats(room_id, reporter_id, reported_id, transcript, request_key)
    VALUES(p_room::text, p_user, peer, p_transcript, p_room::text || ':' || p_user::text)
    ON CONFLICT(request_key) DO UPDATE SET request_key = excluded.request_key
    RETURNING id INTO report_id;
  RETURN report_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.delete_own_user_account() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(74190231);
  UPDATE public.active_rooms SET ended_at = coalesce(ended_at, now()),
    end_reason = coalesce(end_reason, 'account_unavailable') WHERE auth.uid() IN (user_a, user_b);
  UPDATE public.reported_chats SET request_key = NULL WHERE reporter_id = auth.uid();
  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;

CREATE POLICY unider_receive ON realtime.messages FOR SELECT TO authenticated
  USING (extension = 'broadcast' AND public.can_receive_room_broadcast(realtime.topic()));
-- Restrictive guards remain effective even if a pre-existing permissive policy exists.
CREATE POLICY unider_read_guard ON realtime.messages AS RESTRICTIVE FOR SELECT TO authenticated
  USING (realtime.topic() NOT LIKE 'room:%' OR public.can_receive_room_broadcast(realtime.topic()));
CREATE POLICY unider_write_guard ON realtime.messages AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (realtime.topic() NOT LIKE 'room:%');

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA unider_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.authorize_room(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_room(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.persist_room_report(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_room_report(uuid, uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.accept_terms(text), public.find_or_join_match(), public.get_room_state(uuid),
  public.extend_room(uuid), public.leave_room(uuid), public.leave_matchmaking(),
  public.delete_own_user_account(), public.can_receive_room_broadcast(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_terms(text), public.find_or_join_match(), public.get_room_state(uuid),
  public.extend_room(uuid), public.leave_room(uuid), public.leave_matchmaking(),
  public.delete_own_user_account(), public.can_receive_room_broadcast(text) TO authenticated;
REVOKE ALL ON FUNCTION public.purge_old_reports(), public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Regular cleanup includes abandoned queue/room metadata; no chat text in Postgres
-- except explicit reports. Account FK cascade works while reports remain retained.
CREATE OR REPLACE FUNCTION public.purge_old_reports() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.reported_chats WHERE created_at < now() - interval '30 days';
  DELETE FROM public.matchmaking_queue WHERE lease_until <= now();
  DELETE FROM public.active_rooms WHERE hard_close_at < now() - interval '1 day';
END;
$$;
SELECT cron.schedule('purge-old-reports', '*/5 * * * *', 'SELECT public.purge_old_reports()');
COMMIT;
