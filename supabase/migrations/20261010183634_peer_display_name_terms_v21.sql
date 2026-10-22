-- Explicit notice of peer-visible display names; no backfill or broad table reads.
BEGIN;
CREATE OR REPLACE FUNCTION public.accept_terms(p_version text, p_adult boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR p_version IS DISTINCT FROM '2.1' OR p_adult IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Invalid terms or adult declaration' USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles SET terms_version = p_version, terms_accepted_at = now(), adult_declared_at = now()
    WHERE id = auth.uid() AND is_banned IS FALSE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account unavailable' USING ERRCODE = '42501'; END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_terms(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_terms(text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  details jsonb := NEW.raw_user_meta_data;
  birth date;
  cutoff date := (now() AT TIME ZONE 'Europe/Lisbon')::date;
  chosen_name text := btrim(details->>'registration_name');
BEGIN
  IF NEW.email IS NULL OR lower(NEW.email) !~ '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@student\.uc\.pt$' THEN
    RAISE EXCEPTION 'Institutional email required' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(details->'registration_name') IS DISTINCT FROM 'string'
    OR chosen_name IS NULL OR char_length(chosen_name) NOT BETWEEN 1 AND 80 OR chosen_name ~ '[[:cntrl:]]'
    OR jsonb_typeof(details->'birth_date') IS DISTINCT FROM 'string'
    OR (details->>'birth_date') !~ '^\d{4}-\d{2}-\d{2}$'
    OR jsonb_typeof(details->'gender') IS DISTINCT FROM 'string'
    OR (details->>'gender') NOT IN ('male', 'female', 'undisclosed')
    OR details->'adult' IS DISTINCT FROM 'true'::jsonb
    OR details->>'terms_version' IS DISTINCT FROM '2.1' THEN
    RAISE EXCEPTION 'Registration details and explicit acceptance required' USING ERRCODE = '23514';
  END IF;
  BEGIN birth := (details->>'birth_date')::date;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Invalid birth date' USING ERRCODE = '23514';
  END;
  IF birth < DATE '1900-01-01' OR birth > (cutoff - INTERVAL '18 years')::date THEN
    RAISE EXCEPTION 'Adult birth date required' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.profiles(id,email,terms_version,terms_accepted_at,adult_declared_at)
    VALUES (NEW.id,lower(NEW.email),'2.1',now(),now());
  INSERT INTO public.account_details(user_id,name,birth_date,gender)
    VALUES (NEW.id,chosen_name,birth,details->>'gender');
  -- Snapshot only validated initial registration data. Later user_metadata/JWT
  -- edits do not change this protected record, consent, bans or authorization.
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION unider_private.eligible(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id = p.id
    WHERE p.id = p_user AND p.is_banned IS FALSE AND p.terms_version = '2.1'
    AND p.terms_accepted_at IS NOT NULL AND p.adult_declared_at IS NOT NULL
    AND u.email_confirmed_at IS NOT NULL AND lower(u.email) LIKE '%@student.uc.pt');
$$;
REVOKE ALL ON FUNCTION unider_private.eligible(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION unider_private.room_json(r public.active_rooms, p_user uuid) RETURNS json
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT json_build_object('status', 'matched', 'room_id', r.id,
    'peer_id', CASE WHEN r.user_a = p_user THEN r.user_b ELSE r.user_a END,
    'peer_name', (SELECT d.name FROM public.account_details d
      WHERE d.user_id = CASE WHEN r.user_a = p_user THEN r.user_b ELSE r.user_a END
        AND unider_private.eligible(p_user) AND unider_private.eligible(d.user_id)),
    'expires_at', r.expires_at, 'hard_close_at', r.hard_close_at,
    'decision_until', least(r.hard_close_at, r.expires_at + CASE WHEN r.extended_once THEN interval '0 seconds' ELSE interval '30 seconds' END),
    'ended_at', r.ended_at, 'end_reason', r.end_reason, 'extended_once', r.extended_once,
    'extended', CASE WHEN r.user_a = p_user THEN r.extend_a ELSE r.extend_b END,
    'peer_extended', CASE WHEN r.user_a = p_user THEN r.extend_b ELSE r.extend_a END,
    'server_now', now())
  WHERE p_user IN (r.user_a, r.user_b);
$$;
REVOKE ALL ON FUNCTION unider_private.room_json(public.active_rooms, uuid) FROM PUBLIC, anon, authenticated;
-- No direct details grants change.
COMMIT;
