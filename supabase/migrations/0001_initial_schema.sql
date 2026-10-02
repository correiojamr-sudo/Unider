-- 1. Perfis de estudantes
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  is_banned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Trigger de registo automático com validação segura de domínio
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  IF new.email IS NULL OR LOWER(new.email) NOT LIKE '%@student.uc.pt' THEN
    RAISE EXCEPTION 'Acesso restrito ao domínio @student.uc.pt';
  END IF;

  INSERT INTO public.profiles (id, email)
  VALUES (new.id, LOWER(new.email))
  ON CONFLICT (id) DO NOTHING;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 3. Sugestões de Quebra-Gelos diurnos
CREATE TABLE IF NOT EXISTS public.icebreaker_suggestions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  suggestion TEXT NOT NULL CHECK (char_length(suggestion) BETWEEN 5 AND 180),
  is_approved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Registos Forenses de Auditoria (Apenas criados sob denúncia)
CREATE TABLE IF NOT EXISTS public.reported_chats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id TEXT NOT NULL,
  reporter_id UUID REFERENCES public.profiles(id) NOT NULL,
  reported_id UUID REFERENCES public.profiles(id) NOT NULL,
  transcript JSONB NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed', 'banned', 'sent_to_authorities')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Ativar Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.icebreaker_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reported_chats ENABLE ROW LEVEL SECURITY;

-- 6. Garantir permissões de acesso ao role authenticated
GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT, INSERT ON public.icebreaker_suggestions TO authenticated;
GRANT INSERT ON public.reported_chats TO authenticated;

-- 7. Políticas de RLS
DROP POLICY IF EXISTS "Leitura do próprio perfil" ON public.profiles;
CREATE POLICY "Leitura do próprio perfil"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Inserção de sugestões" ON public.icebreaker_suggestions;
CREATE POLICY "Inserção de sugestões"
  ON public.icebreaker_suggestions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Leitura de sugestões aprovadas" ON public.icebreaker_suggestions;
CREATE POLICY "Leitura de sugestões aprovadas"
  ON public.icebreaker_suggestions FOR SELECT
  USING (is_approved = true);

DROP POLICY IF EXISTS "Inserção de denúncia" ON public.reported_chats;
CREATE POLICY "Inserção de denúncia"
  ON public.reported_chats FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);