# Problemas em aberto — revisão de 05/10/2026

## Âmbito e estado

Pedido do proprietário: analisar, apontar problemas e manter memória; **não
corrigir nesta tarefa**. Base: `5fcd34b4eaa6b5cd4fa8681817128a4c6bdfb33f`, branch
`fix/unider-functional-recovery`, código do PR #8. A árvore estava limpa no
início. Esta revisão acrescenta apenas documentação local, sem commit/push.

Foram revistos frontend, Auth, fila, chat, handlers, migrations e testes
relevantes. Duas revisões auxiliares foram exclusivamente de leitura. A lista
não certifica ausência de outros problemas nem o ambiente publicado.

**Atualização de 08/10:** A01–A05 foram corrigidos e aceites no código local;
ver [entrega integrada e testes](2026-10-08-findings-fixes.md). A migration e
o código novo ainda não foram publicados nos serviços. As descrições, fontes
e reproduções abaixo preservam a revisão da base original, não o candidato corrigido.

Na revisão original todos os itens estavam **ABERTOS — NÃO CORRIGIDOS**. `[Certain]` indica
evidência direta no código/reprodução local; não significa exploração observada
no serviço real. P1: corrigir antes de abrir a plataforma; P2: defeito funcional
acionável. Não confundir estes IDs com F01–F12 da auditoria anterior.

| ID | Prioridade | Problema | Evidência | Área proposta |
| --- | --- | --- | --- | --- |
| A01 | P1 | Utilizador aprova a própria sugestão | PGlite com migrations atuais | Backend e Segurança |
| A02 | P2 | Cancelamento da fila perde corrida com emparelhamento | SQL isolado + componente/estado em memória | Backend e Produto, numa tarefa transversal |
| A03 | P2 | UUID repetido entre participantes quebra mensagens/histórico | Handlers e fusão reais com dependências simuladas | Backend e Produto, numa tarefa transversal |
| A04 | P2 | Sala já purgada bloqueia logout | Store real com transporte simulado + SQL | Produto e Interface |
| A05 | P2 | Pedidos do lobby sem prazo bloqueiam recuperação | Inspeção do código e SDK instalado | Produto e Interface |

## A01 — Sugestões podem ser aprovadas pelo próprio autor

**[Certain]** A permissão de INSERT cobre todas as colunas e a política verifica
apenas `auth.uid() = user_id`. O cliente pode enviar `is_approved: true`.
A migration de segurança posterior não restringe esse campo. O chat seleciona
sugestões aprovadas, pelo que o texto não revisto entra no conjunto apresentado
aos outros participantes.

Fontes: [schema inicial](../../supabase/migrations/0001_initial_schema.sql),
linhas 60 e 70–77; [consumo no chat](../../src/pages/Chat.tsx), linhas 73–75.

Reprodução local: carregar as três migrations numa PGlite em memória; criar
duas identidades sintéticas; com papel `authenticated` e identidade A inserir
uma sugestão própria com `is_approved=true`; ler como B. Resultado:
`self_approved_visible_to_peer = [{ is_approved: true, ... }]`. Não houve pedido
ao Supabase alojado. O impacto comprovado é contornar a moderação, não executar
HTML/JavaScript: a interface renderiza o texto através de React.

Trabalho futuro: impor aprovação exclusivamente administrativa no servidor e
rever as permissões de inserção, com migration nova. Aceitação: uma identidade
comum não consegue criar conteúdo aprovado por INSERT direto; aprovação pela
via administrativa continua possível; chat só recebe conteúdo aprovado por ela.

## A02 — Cancelar a fila pode deixar o utilizador numa sala

**[Certain]** O botão de saída chama `leave_matchmaking` enquanto o polling de
`find_or_join_match` continua ativo. Se o match chega primeiro, `setRoom` muda
o contexto e a confirmação da saída é ignorada. Além disso, o RPC de saída só
apaga a entrada da fila: não fecha uma sala criada entretanto nem participa no
mesmo mecanismo de serialização do emparelhamento.

Fontes: [saída no Chat](../../src/pages/Chat.tsx), linhas 81–99;
[polling](../../src/hooks/useChatSession.ts), linhas 53–65;
[guard da operação](../../src/lib/chatOperations.ts), linhas 12–18;
[RPC de saída](../../supabase/migrations/0002_matchmaking_and_gdpr.sql),
linhas 90–99; [emparelhamento atual](../../supabase/migrations/20261002231850_secure_chat_lifecycle.sql),
linhas 97–136.

Reproduções:

- PGlite: A recebe `waiting`; B emparelha com A; A chama `leave_matchmaking`
  com sucesso; a sala continua com `ended_at IS NULL`.
- Componente Chat transpilado e store/guards reais em memória, hooks/transporte
  simulados: acionar «Voltar ao Lobby», aplicar match e depois resolver a saída
  com `error:null` resulta em `navigation=[]` e sala ainda selecionada.

O utilizador pode entrar numa conversa depois de pedir cancelamento, ou deixar
uma sala abandonada à espera do heartbeat expirar. A reprodução SQL é uma ordem
determinística dos eventos, não um teste de concorrência PostgreSQL real.

Trabalho futuro: definir cancelamento consistente entre intenção cliente e estado
servidor, preservando guards contra respostas antigas. Aceitação: testar ambas
as ordens das respostas e pedidos sobrepostos; cancelamento confirmado conclui
a saída e não deixa uma sala ativa criada pelo pedido que foi cancelado.

## A03 — Identidade de mensagem inconsistente entre envio e histórico

**[Certain]** O envio deduplica por `userId:messageId`, mas o frontend e a leitura
do histórico identificam mensagens apenas por `messageId`. Um participante pode
copiar o UUID de uma mensagem recebida e enviar uma mensagem distinta com esse
UUID. Ambos os envios são aceites; a interface conserva só uma e o snapshot
recusa o buffer inteiro por conflito.

Fontes: [envio](../../supabase/functions/send-message/handler.ts), linhas 30–36;
[snapshot](../../supabase/functions/get-room-messages/handler.ts), linhas 31–45;
[fusão cliente](../../src/lib/chatHistory.ts), linhas 18–24 e 31–36;
[chave React](../../src/pages/Chat.tsx), linha 191.

Reprodução: reutilizar a fixture Edge em memória, enviar como A e depois B com
o mesmo UUID e textos diferentes; executar o handler real de histórico e
`mergeChatMessages`. Resultado: `firstSend=200`, `secondSend=200`,
`bufferMessages=2`, `clientMessages=1`, `snapshotStatus=503` (`Invalid buffer`).
Auth/RPC/Redis foram simulados; o teste comprova a incompatibilidade dos handlers
e da fusão, não concorrência Lua alojada. Não foi demonstrada falsificação do
remetente nem alteração de prova SQL persistida.

Trabalho futuro: escolher um contrato único de identidade, seja UUID exclusivo
da sala ou chave composta, e aplicá-lo a envio, deduplicação, histórico, stores
e apresentação. Aceitação: colisão intencional entre participantes não esconde
mensagens nem inutiliza o histórico; retry legítimo continua idempotente.

## A04 — Sala removida pela limpeza impede terminar sessão

**[Certain]** Uma `roomId` pode permanecer no `sessionStorage` de um separador
aberto depois de a sala ser purgada. O logout exige primeiro sucesso de
`leave_room`; para uma sala inexistente, o SQL devolve `42501`. O cliente aborta
antes de chamar Auth e recomenda repetir, mantendo a mesma referência inválida.

Fontes: [logout](../../src/store/authStore.ts), linhas 63–74;
[saída e limpeza SQL](../../supabase/migrations/20261002231850_secure_chat_lifecycle.sql),
linhas 175–183 e 277;
[persistência do chat](../../src/store/chatStore.ts), linhas 74–77.

Reprodução com store real e resposta RPC simulada `42501`: duas tentativas de
logout devolveram `false`; chamadas `['leave_room','leave_room']`; sessão e
sala mantidas, sem chamada Auth. O SQL confirma que sala inexistente produz esse
erro. Repetir o botão não resolve; exige recuperação/limpeza do contexto por
outro percurso. O cenário de purga alojada não foi executado.

Trabalho futuro: permitir terminar sessão quando já não existe uma conversa
válida para fechar, distinguindo essa situação de falha transitória e sem
afirmar encerramento remoto não confirmado. Aceitação: testar sala persistida
purgada, sala ainda ativa e falha de rede, incluindo respostas antigas.

## A05 — Pedidos pendentes deixam o lobby sem recuperação delimitada

**[Certain]** A leitura dos termos e a inserção de sugestões não definem timeout
ou sinal de cancelamento. Se o transporte fica pendente, os termos continuam em
`checking`: entrada desativada e retry só disponível depois de `error`. Na
sugestão, `submitting`/`suggestionBusy` bloqueiam edição e novo envio até o
pedido terminar. O SDK PostgREST instalado encaminha o sinal fornecido; estas
chamadas não recebem o limite de 10 segundos usado noutros fluxos.

Fontes: [Lobby](../../src/pages/Lobby.tsx), linhas 47–63, 86–109, 176–188 e
201–215; [cliente Supabase](../../src/lib/supabase.ts), sem timeout global;
[helper de sugestão](../../src/lib/lobbySuggestion.ts), que aguarda o pedido.

Evidência estática: sequência dos estados e ausência de um prazo no pedido.
**Não reproduzido num browser com transporte pendente.** Não pressupõe que todos
os browsers esperem indefinidamente; o problema é a aplicação não garantir um
prazo de recuperação nem oferecer uma ação durante essa espera.

Trabalho futuro: limitar/cancelar os pedidos e expor retry preservando texto e
contexto. Aceitação: manter as duas respostas pendentes além do prazo escolhido,
verificar desbloqueio/erro recuperável e garantir que uma resposta antiga não
afeta outro utilizador ou pedido.

## Validação e limites desta entrega

- Reproduções A01/A02: PGlite descartável em memória, sem URL de base remota.
- Reproduções A02/A03/A04: código real com dependências locais/simuladas;
  nenhum ficheiro de implementação ou de teste foi alterado.
- Revisão auxiliar: 20 testes Auth/lobby/clock passaram com
  `node --test --test-isolation=none tests/auth.test.cjs tests/lobby.test.cjs tests/clock.test.cjs`.
  Esses testes verdes não cobrem os cenários novos acima.
- Nesta tarefa não se repetiram build/lint/full suite: só há alterações
  documentais e nenhuma correção implementada. Verificaram-se links e whitespace.
- Nenhum deploy, migration aplicada, conta/email real, configuração remota,
  commit, push ou atualização do PR foi feito nesta revisão.

As pendências de integração real continuam na
[matriz existente](2026-10-05-integration-readiness.md). São trabalho por validar,
não novos bugs comprovados. Antes de retomar, conferir a versão e revalidar estes
itens; não reaplicar migrations históricas. Só fechar cada item com correção
revista e evidência dos critérios de aceitação.
