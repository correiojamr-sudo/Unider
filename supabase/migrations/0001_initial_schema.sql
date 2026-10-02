-- Perfis de estudantes
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  is_banned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Trigger de registo automático
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  IF new.email NOT LIKE '%@student.uc.pt' THEN
    RAISE EXCEPTION 'Acesso restrito ao domínio @student.uc.pt';
  END IF;
  INSERT INTO public.profiles (id, email) VALUES (new.id, new.email);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Sugestões de Quebra-Gelos diurnos
CREATE TABLE public.icebreaker_suggestions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  suggestion TEXT NOT NULL CHECK (char_length(suggestion) BETWEEN 5 AND 180),
  is_approved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Registos Forenses de Auditoria (Apenas criados sob denúncia)
CREATE TABLE public.reported_chats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id TEXT NOT NULL,
  reporter_id UUID REFERENCES public.profiles(id) NOT NULL,
  reported_id UUID REFERENCES public.profiles(id) NOT NULL,
  transcript JSONB NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed', 'banned', 'sent_to_authorities')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.icebreaker_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reported_chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leitura do próprio perfil" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Inserção de sugestões" ON public.icebreaker_suggestions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Leitura de sugestões aprovadas" ON public.icebreaker_suggestions FOR SELECT USING (is_approved = true);
CREATE POLICY "Inserção de denúncia" ON public.reported_chats FOR INSERT WITH CHECK (auth.uid() = reporter_id);
