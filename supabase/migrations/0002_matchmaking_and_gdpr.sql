-- 1. Matchmaking Migration (PostgreSQL)

CREATE TABLE IF NOT EXISTS public.matchmaking_queue (
  user_id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  joined_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.active_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a UUID REFERENCES auth.users ON DELETE CASCADE,
  user_b UUID REFERENCES auth.users ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.active_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see their own active rooms"
  ON public.active_rooms FOR SELECT
  USING (auth.uid() = user_a OR auth.uid() = user_b);

GRANT SELECT ON public.active_rooms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matchmaking_queue TO authenticated;

-- RPC for find_or_join_match
CREATE OR REPLACE FUNCTION public.find_or_join_match()
RETURNS JSON
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_existing_room RECORD;
  v_matched_peer UUID;
  v_new_room_id UUID;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Check if the caller already belongs to an existing room in active_rooms
  SELECT * INTO v_existing_room
  FROM public.active_rooms
  WHERE user_a = v_caller_id OR user_b = v_caller_id
  LIMIT 1;

  IF FOUND THEN
    RETURN json_build_object(
      'status', 'matched',
      'room_id', v_existing_room.id,
      'peer_id', CASE WHEN v_existing_room.user_a = v_caller_id THEN v_existing_room.user_b ELSE v_existing_room.user_a END
    );
  END IF;

  -- 2. Attempt to lock the oldest entry in matchmaking_queue that does not belong to the caller
  SELECT user_id INTO v_matched_peer
  FROM public.matchmaking_queue
  WHERE user_id != v_caller_id
  ORDER BY joined_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF FOUND THEN
    -- A waiting peer is found: delete both from matchmaking_queue
    DELETE FROM public.matchmaking_queue WHERE user_id IN (v_caller_id, v_matched_peer);

    -- Insert a new row in active_rooms
    INSERT INTO public.active_rooms (user_a, user_b)
    VALUES (v_caller_id, v_matched_peer)
    RETURNING id INTO v_new_room_id;

    RETURN json_build_object(
      'status', 'matched',
      'room_id', v_new_room_id,
      'peer_id', v_matched_peer
    );
  ELSE
    -- No peer available: upsert the caller into matchmaking_queue
    INSERT INTO public.matchmaking_queue (user_id, joined_at)
    VALUES (v_caller_id, now())
    ON CONFLICT (user_id) DO UPDATE SET joined_at = now();

    RETURN json_build_object(
      'status', 'waiting'
    );
  END IF;
END;
$$;

-- RPC to leave matchmaking
CREATE OR REPLACE FUNCTION public.leave_matchmaking()
RETURNS VOID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    DELETE FROM public.matchmaking_queue WHERE user_id = auth.uid();
  END IF;
END;
$$;

-- 2. Right to Be Forgotten (GDPR) & Terms of Use

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS terms_version TEXT;

CREATE OR REPLACE FUNCTION public.delete_own_user_account()
RETURNS VOID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;

-- 4. Anti-Spoofing Reporting & Ephemeral Buffer - pg_cron
-- We'll assume the pg_cron extension is available for Supabase
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.purge_old_reports()
RETURNS VOID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.reported_chats
  WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$;

-- Run daily at midnight
SELECT cron.schedule('purge-old-reports', '0 0 * * *', 'SELECT public.purge_old_reports()');
