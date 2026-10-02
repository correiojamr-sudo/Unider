-- 1. GDPR & Terms
ALTER TABLE public.profiles
ADD COLUMN terms_accepted_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN terms_version TEXT DEFAULT '1.0';

-- 2. Matchmaking Queue & Active Rooms
CREATE TABLE public.matchmaking_queue (
    user_id UUID REFERENCES public.profiles(id) PRIMARY KEY,
    joined_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.active_rooms (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_a UUID REFERENCES public.profiles(id) NOT NULL,
    user_b UUID REFERENCES public.profiles(id) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS para matchmaking
ALTER TABLE public.matchmaking_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Utilizador gere própria fila" ON public.matchmaking_queue
    FOR ALL USING (auth.uid() = user_id);

ALTER TABLE public.active_rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Participantes leem sala" ON public.active_rooms
    FOR SELECT USING (auth.uid() = user_a OR auth.uid() = user_b);

-- 3. Matchmaking RPC (Atomic)
CREATE OR REPLACE FUNCTION public.find_or_join_match()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    matched_user UUID;
    new_room_id UUID;
    existing_room UUID;
BEGIN
    -- Check se o user já está numa sala ativa
    SELECT id INTO existing_room FROM public.active_rooms
    WHERE user_a = auth.uid() OR user_b = auth.uid()
    ORDER BY created_at DESC LIMIT 1;

    IF existing_room IS NOT NULL THEN
        RETURN existing_room;
    END IF;

    -- Tentar encontrar o par mais antigo na fila
    SELECT user_id INTO matched_user
    FROM public.matchmaking_queue
    WHERE user_id != auth.uid()
    ORDER BY joined_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF matched_user IS NOT NULL THEN
        -- Par encontrado! Remover o par da fila
        DELETE FROM public.matchmaking_queue WHERE user_id = matched_user;

        -- Criar sala
        INSERT INTO public.active_rooms (user_a, user_b)
        VALUES (auth.uid(), matched_user)
        RETURNING id INTO new_room_id;

        RETURN new_room_id;
    ELSE
        -- Nenhum par, inserir-se na fila
        INSERT INTO public.matchmaking_queue (user_id)
        VALUES (auth.uid())
        ON CONFLICT (user_id) DO UPDATE SET joined_at = now();

        RETURN NULL; -- Indica que está na fila
    END IF;
END;
$$;

-- RPC para cancelar procura
CREATE OR REPLACE FUNCTION public.leave_matchmaking()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM public.matchmaking_queue WHERE user_id = auth.uid();
END;
$$;

-- 4. Delete Account RPC (GDPR)
CREATE OR REPLACE FUNCTION public.delete_own_user_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- O delete na tabela auth.users vai desencadear o ON DELETE CASCADE nas profiles
    DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;

-- 5. Cron Job para expirar reports antigos
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.purge_old_reports()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM public.reported_chats WHERE created_at < now() - interval '30 days';
END;
$$;

-- Agendar para correr diariamente às 03:00 AM
SELECT cron.schedule('purge-reports', '0 3 * * *', 'SELECT public.purge_old_reports()');
