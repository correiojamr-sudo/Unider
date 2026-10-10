-- New registrations require private details; existing accounts are not backfilled.
-- Apply after adult_terms_v2, together with the password signup frontend.
BEGIN;
CREATE TABLE public.account_details (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80 AND name = btrim(name) AND name !~ '[[:cntrl:]]'),
  birth_date date NOT NULL CHECK (birth_date >= DATE '1900-01-01'),
  gender text NOT NULL CHECK (gender IN ('male', 'female', 'undisclosed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.account_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_details FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.account_details TO authenticated;
GRANT ALL ON public.account_details TO service_role;
CREATE POLICY own_account_details ON public.account_details FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

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
    OR details->>'terms_version' IS DISTINCT FROM '2.0' THEN
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
    VALUES (NEW.id,lower(NEW.email),'2.0',now(),now());
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
    WHERE p.id = p_user AND p.is_banned IS FALSE AND p.terms_version = '2.0'
    AND p.terms_accepted_at IS NOT NULL AND p.adult_declared_at IS NOT NULL
    AND u.email_confirmed_at IS NOT NULL AND lower(u.email) LIKE '%@student.uc.pt');
$$;
REVOKE ALL ON FUNCTION unider_private.eligible(uuid) FROM PUBLIC, anon, authenticated;
COMMIT;
