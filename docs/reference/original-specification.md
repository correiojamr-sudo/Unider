# Especificação original — referência histórica

Este documento preserva a proposta inicial, incluindo o nome CAMPUS DROPS.
Não descreve todos os contratos atuais. O SQL e o exemplo de denúncia direta
abaixo não devem ser executados nem usados como instruções de implementação.
Consultar [arquitetura](../architecture.md), [contratos](../contracts.md) e
[operações](../operations/release.md) para o funcionamento atual.

---

CAMPUS DROPS — ESPECIFICAÇÃO DE IMPLEMENTAÇÃO (PILOTO COIMBRA)

OBJETIVO DO REPOSITÓRIO

Construir uma Progressive Web App (PWA) mobile-first para estudantes da Universidade de Coimbra (@student.uc.pt) com conversas efémeras de texto de 2 minutos durante uma janela diária sincronizada (22h30 às 22h50).

1. TECH STACK & CONFIGURAÇÃO

Build tool & Framework: React (Vite SPA) + TypeScript.

Estilos & UI: Tailwind CSS, Lucide React, layout mobile-first focado em viewport de telemóvel.

Backend / Auth / DB / Sockets: Supabase Client SDK (@supabase/supabase-js).

Target de Deploy: Cloudflare Pages (dist estático / SPA com fallback de rotas /* -> /index.html).

PWA: manifest.json com meta-tags mobile (dark mode, theme-color #0f172a).

2. REGRAS DE CONTROLO TEMPORAL (HORÁRIO DE LISBOA / PORTUGAL)

A aplicação deve alternar automaticamente de estado com base na hora do cliente sincronizada:

Modo Diurno (00:00 - 22:27:59 e 22:50 - 23:59:59):

Ecrã exibe contagem decrescente para as 22h28.

Caixa aberta: "Sugere um quebra-gelo para hoje" -> submete para tabela icebreaker_suggestions.

Modo Fila de Espera (22:28:00 - 22:29:59):

Contador dá lugar ao botão "Entrar na Fila do Campus".

Utilizadores autenticados subscrevem canal Supabase Realtime Presence (campus-queue).

Exibe ecrã de espera: "Estás na fila. As conversas começam em [MM:SS]".

Modo Janela Ativa (22:30:00 - 22:49:59):

Algoritmo de emparelhamento 1-para-1 automático dos utilizadores presentes na fila em canais privados (room_<id>).

Cronómetro decrescente de 120 segundos (02:00 -> 00:00).

Pergunta quebra-gelo visível no topo (extraída de icebreaker_suggestions aprovadas ou fallback hardcoded de Coimbra).

Aos 02:00, o input bloqueia e surgem 2 botões: "Continuar (+3 min)" ou "Passar". Só estende se ambos clicarem "Continuar".

Encerramento (22:50:00):

Desconecta salas ativas e regressa ao Modo Diurno com contador para o dia seguinte.

3. AUTENTICAÇÃO E REGRAS DE SEGURANÇA

Validação estrita: input de email só aceita o domínio @student.uc.pt. Rejeitar qualquer outro com aviso imediato.

Login sem password via Supabase Auth OTP (código de 6 dígitos enviado por email).

Checkbox obrigatória no formulário de login com texto legal explícito:
"As conversas são confidenciais e efémeras. Em caso de denúncia fundamentada de assédio, ameaças ou conduta ilícita, o registo integral da conversa é preservado na base de dados para auditoria interna e eventual encaminhamento às autoridades judiciais e policiais (PJ / MP) mediante ordem legal."

Se profiles.is_banned == true, bloquear acesso de imediato.

4. BASE DE DADOS POSTGRESQL (MIGRATION SUPABASE)

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


5. MECÂNICA DE CHAT EFÉMERO E AUDITORIA FORENSE

Tráfego em Memória: As mensagens das conversas normais usam apenas canais Broadcast do Supabase Realtime. Não gravar mensagens normais nas tabelas.

Botão "Denunciar":

Sempre visível no ecrã de chat.

Ao ser clicado, a sala fecha imediatamente para ambos.

O cliente do queixoso executa:

await supabase.from('reported_chats').insert({
  room_id,
  reporter_id: currentUserId,
  reported_id: peerUserId,
  transcript: localChatMessages,
  status: 'pending'
});


Regras RLS impedem UPDATE ou DELETE por parte de qualquer utilizador comum.

6. ESTRUTURA DE ECRÃS E ROTAS

/login: Campo email (@student.uc.pt), OTP de 6 dígitos, checkbox legal e botão de entrada.

/lobby: Alterna entre Contador Diurno + Sugestões OU Botão de Entrada na Fila às 22h28.

/chat: Topo com timer (02:00), caixa suspensa do quebra-gelo, balões de texto simples ("Tu" e "Colega"), botão de denúncia e modal de decisão aos 02:00.
