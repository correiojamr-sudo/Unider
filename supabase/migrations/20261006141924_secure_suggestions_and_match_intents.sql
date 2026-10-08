-- Incremental A01/A02/A04 repair. Apply only after reconciling the hosted
-- bootstrap history; old no-argument matchmaking clients fail closed.
BEGIN;

-- A01: table grants and inherited column grants are independent in PostgreSQL.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.icebreaker_suggestions FROM PUBLIC, anon, authenticated;
REVOKE INSERT (id, user_id, suggestion, is_approved, created_at),
  UPDATE (id, user_id, suggestion, is_approved, created_at),
  REFERENCES (id, user_id, suggestion, is_approved, created_at)
  ON public.icebreaker_suggestions FROM PUBLIC, anon, authenticated;
GRANT INSERT (user_id, suggestion) ON public.icebreaker_suggestions TO authenticated;
DROP POLICY "Inserção de sugestões" ON public.icebreaker_suggestions;
CREATE POLICY "Inserção de sugestões" ON public.icebreaker_suggestions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND is_approved IS FALSE);

-- No plaintext or credentials: only a per-entry cancellation fence and room link.
CREATE TABLE unider_private.matchmaking_intents (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  intent_id uuid NOT NULL,
  intent_day date NOT NULL,
  cancelled_at timestamptz,
  room_id uuid,
  PRIMARY KEY (user_id, intent_id, intent_day)
);
ALTER TABLE unider_private.matchmaking_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON unider_private.matchmaking_intents FROM PUBLIC, anon, authenticated;
CREATE INDEX matchmaking_intents_room ON unider_private.matchmaking_intents(room_id) WHERE room_id IS NOT NULL;
CREATE INDEX matchmaking_intents_day ON unider_private.matchmaking_intents(intent_day);
ALTER TABLE public.matchmaking_queue ADD COLUMN intent_id uuid, ADD COLUMN intent_day date;

DROP FUNCTION public.find_or_join_match();
DROP FUNCTION public.leave_matchmaking();

CREATE FUNCTION public.find_or_join_match(p_intent uuid, p_day date) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := auth.uid(); candidate public.matchmaking_queue;
  entry unider_private.matchmaking_intents; r public.active_rooms;
  local_time timestamp := now() AT TIME ZONE 'Europe/Lisbon'; close_at timestamptz;
BEGIN
  IF NOT unider_private.eligible(caller) THEN RAISE EXCEPTION 'Account or consent unavailable' USING ERRCODE = '42501'; END IF;
  IF p_intent IS NULL OR p_day IS NULL THEN RAISE EXCEPTION 'Entry intent required' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(74190231);
  -- This check remains effective even after an old cancellation marker is purged.
  IF p_day <> local_time::date THEN RETURN json_build_object('status', 'closed', 'server_now', now()); END IF;
  INSERT INTO unider_private.matchmaking_intents(user_id, intent_id, intent_day)
    VALUES(caller, p_intent, p_day) ON CONFLICT DO NOTHING;
  SELECT * INTO entry FROM unider_private.matchmaking_intents
    WHERE user_id = caller AND intent_id = p_intent AND intent_day = p_day;
  IF entry.cancelled_at IS NOT NULL THEN RETURN json_build_object('status', 'cancelled', 'server_now', now()); END IF;
  IF entry.room_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.active_rooms WHERE id = entry.room_id) THEN
      r := unider_private.refresh_room(entry.room_id);
      RETURN unider_private.room_json(r, caller);
    END IF;
    UPDATE unider_private.matchmaking_intents SET cancelled_at = now()
      WHERE user_id = caller AND intent_id = p_intent AND intent_day = p_day;
    RETURN json_build_object('status', 'cancelled', 'server_now', now());
  END IF;

  -- A new entry supersedes an older waiting entry, never its successor.
  UPDATE unider_private.matchmaking_intents i SET cancelled_at = coalesce(i.cancelled_at, now())
    FROM public.matchmaking_queue q WHERE q.user_id = caller
      AND (q.intent_id, q.intent_day) IS DISTINCT FROM (p_intent, p_day)
      AND i.user_id = q.user_id AND i.intent_id = q.intent_id AND i.intent_day = q.intent_day;
  DELETE FROM public.matchmaking_queue WHERE user_id = caller
    AND (intent_id, intent_day) IS DISTINCT FROM (p_intent, p_day);
  FOR r IN SELECT * FROM public.active_rooms WHERE ended_at IS NULL AND caller IN (user_a, user_b) LOOP
    r := unider_private.refresh_room(r.id);
    IF r.ended_at IS NULL THEN
      UPDATE unider_private.matchmaking_intents SET room_id = r.id
        WHERE user_id = caller AND intent_id = p_intent AND intent_day = p_day;
      DELETE FROM public.matchmaking_queue WHERE user_id = caller;
      RETURN unider_private.room_json(r, caller);
    END IF;
  END LOOP;
  IF local_time::time < time '22:30' OR local_time::time >= time '22:48' THEN
    DELETE FROM public.matchmaking_queue WHERE user_id = caller AND intent_id = p_intent AND intent_day = p_day;
    RETURN json_build_object('status', 'closed', 'server_now', now());
  END IF;
  close_at := (local_time::date + time '22:50') AT TIME ZONE 'Europe/Lisbon';
  FOR r IN SELECT * FROM public.active_rooms WHERE ended_at IS NULL LOOP
    PERFORM unider_private.refresh_room(r.id);
  END LOOP;
  DELETE FROM public.matchmaking_queue q WHERE q.lease_until <= now()
    OR q.intent_day IS DISTINCT FROM local_time::date OR q.intent_id IS NULL
    OR NOT unider_private.eligible(q.user_id)
    OR NOT EXISTS (SELECT 1 FROM unider_private.matchmaking_intents i WHERE i.user_id = q.user_id
      AND i.intent_id = q.intent_id AND i.intent_day = q.intent_day AND i.cancelled_at IS NULL AND i.room_id IS NULL)
    OR EXISTS (SELECT 1 FROM public.active_rooms a WHERE a.ended_at IS NULL AND q.user_id IN (a.user_a, a.user_b));
  SELECT * INTO candidate FROM public.matchmaking_queue
    WHERE user_id <> caller ORDER BY joined_at, user_id LIMIT 1;
  IF candidate.user_id IS NOT NULL THEN
    DELETE FROM public.matchmaking_queue WHERE user_id IN (caller, candidate.user_id);
    INSERT INTO public.active_rooms(user_a, user_b, expires_at, hard_close_at)
      VALUES(caller, candidate.user_id, least(now() + interval '2 minutes', close_at), close_at) RETURNING * INTO r;
    UPDATE unider_private.matchmaking_intents SET room_id = r.id
      WHERE (user_id = caller AND intent_id = p_intent AND intent_day = p_day)
        OR (user_id = candidate.user_id AND intent_id = candidate.intent_id AND intent_day = candidate.intent_day);
    RETURN unider_private.room_json(r, caller);
  END IF;
  INSERT INTO public.matchmaking_queue(user_id, lease_until, intent_id, intent_day)
    VALUES(caller, now() + interval '15 seconds', p_intent, p_day)
    ON CONFLICT(user_id) DO UPDATE SET lease_until = excluded.lease_until,
      intent_id = excluded.intent_id, intent_day = excluded.intent_day;
  RETURN json_build_object('status', 'waiting', 'server_now', now());
END;
$$;

CREATE FUNCTION public.leave_matchmaking(p_intent uuid, p_day date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := auth.uid(); linked_room uuid;
  today date := (now() AT TIME ZONE 'Europe/Lisbon')::date;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_intent IS NULL OR p_day IS NULL OR p_day > today THEN RAISE EXCEPTION 'Invalid entry intent' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(74190231);
  IF p_day = today THEN
    -- The cancel may arrive before the very first find request.
    INSERT INTO unider_private.matchmaking_intents(user_id, intent_id, intent_day, cancelled_at)
      VALUES(caller, p_intent, p_day, now())
      ON CONFLICT (user_id, intent_id, intent_day) DO UPDATE
      SET cancelled_at = coalesce(unider_private.matchmaking_intents.cancelled_at, excluded.cancelled_at);
  ELSE
    UPDATE unider_private.matchmaking_intents SET cancelled_at = coalesce(cancelled_at, now())
      WHERE user_id = caller AND intent_id = p_intent AND intent_day = p_day;
  END IF;
  SELECT room_id INTO linked_room FROM unider_private.matchmaking_intents
    WHERE user_id = caller AND intent_id = p_intent AND intent_day = p_day;
  DELETE FROM public.matchmaking_queue WHERE user_id = caller AND intent_id = p_intent AND intent_day = p_day;
  IF linked_room IS NOT NULL THEN
    UPDATE public.active_rooms SET ended_at = coalesce(ended_at, now()), end_reason = coalesce(end_reason, 'disconnect')
      WHERE id = linked_room AND caller IN (user_a, user_b);
    UPDATE unider_private.matchmaking_intents SET cancelled_at = coalesce(cancelled_at, now()) WHERE room_id = linked_room;
  END IF;
END;
$$;

-- A04: real absence is idempotent, but an existing outsider room is still denied.
CREATE OR REPLACE FUNCTION public.leave_room(p_room uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := auth.uid(); r public.active_rooms;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_room IS NULL THEN RAISE EXCEPTION 'Invalid room' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(74190231);
  SELECT * INTO r FROM public.active_rooms WHERE id = p_room FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF caller NOT IN (r.user_a, r.user_b) THEN RAISE EXCEPTION 'Room unavailable' USING ERRCODE = '42501'; END IF;
  UPDATE public.active_rooms SET ended_at = coalesce(ended_at, now()), end_reason = coalesce(end_reason, 'disconnect') WHERE id = p_room;
  UPDATE unider_private.matchmaking_intents SET cancelled_at = coalesce(cancelled_at, now()) WHERE room_id = p_room;
END;
$$;

REVOKE ALL ON FUNCTION public.find_or_join_match(uuid, date), public.leave_matchmaking(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_or_join_match(uuid, date), public.leave_matchmaking(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.purge_old_reports() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.reported_chats WHERE created_at < now() - interval '30 days';
  DELETE FROM public.matchmaking_queue WHERE lease_until <= now();
  DELETE FROM public.active_rooms WHERE hard_close_at < now() - interval '1 day';
  -- Keep today and yesterday; find rejects the date before consulting this table.
  DELETE FROM unider_private.matchmaking_intents WHERE intent_day < (now() AT TIME ZONE 'Europe/Lisbon')::date - 1;
END;
$$;
COMMIT;
