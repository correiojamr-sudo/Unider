-- Apply only in a coordinated release with the frontend terms 2.0.
BEGIN;
ALTER TABLE public.profiles ADD COLUMN adult_declared_at timestamptz;

CREATE OR REPLACE FUNCTION unider_private.eligible(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user
    AND is_banned IS FALSE AND terms_version = '2.0'
    AND terms_accepted_at IS NOT NULL AND adult_declared_at IS NOT NULL);
$$;

-- An old client must not silently attest adulthood or accept a changed text.
CREATE OR REPLACE FUNCTION public.accept_terms(p_version text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Explicit adult declaration required' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION public.accept_terms(text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.accept_terms(p_version text, p_adult boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR p_version IS DISTINCT FROM '2.0' OR p_adult IS DISTINCT FROM true THEN
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
REVOKE ALL ON FUNCTION unider_private.eligible(uuid) FROM PUBLIC, anon, authenticated;
COMMIT;
