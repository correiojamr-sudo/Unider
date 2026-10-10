-- B01: polling must not extend the reporting window. No history/data rewrite.
BEGIN;

CREATE FUNCTION unider_private.room_end_limit(r public.active_rooms) RETURNS timestamptz
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT least(r.ended_at, r.hard_close_at,
    r.expires_at + CASE WHEN r.extended_once THEN interval '0 seconds' ELSE interval '30 seconds' END,
    least(r.heartbeat_a, r.heartbeat_b) + interval '45 seconds');
$$;
REVOKE ALL ON FUNCTION unider_private.room_end_limit(public.active_rooms) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION unider_private.refresh_room(p_room uuid) RETURNS public.active_rooms
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
      -- Eligibility loss can close early; elapsed scheduled limits cannot move forward.
      UPDATE public.active_rooms SET ended_at = least(now(), unider_private.room_end_limit(r)), end_reason = r.end_reason
        WHERE id = p_room RETURNING * INTO r;
    END IF;
  END IF;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.authorize_room(p_room uuid, p_user uuid, p_operation text) RETURNS json
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
    -- Includes legacy ended_at values recorded by a late observation, without
    -- changing explicit close timestamps or already persisted report evidence.
    IF now() > unider_private.room_end_limit(r) + interval '5 minutes' THEN
      RAISE EXCEPTION 'Report window expired' USING ERRCODE = '42501';
    END IF;
    UPDATE public.active_rooms SET ended_at = coalesce(ended_at, now()), end_reason = coalesce(end_reason, 'report')
      WHERE id = p_room RETURNING * INTO r;
  ELSE RAISE EXCEPTION 'Invalid operation';
  END IF;
  RETURN unider_private.room_json(r, p_user);
END;
$$;
REVOKE ALL ON FUNCTION public.authorize_room(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_room(uuid, uuid, text) TO service_role;
COMMIT;
