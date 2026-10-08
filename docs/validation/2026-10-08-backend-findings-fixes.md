# Candidato local A01–A04 — 08/10/2026

## Objetivo e base

Rever e terminar o candidato das correções A01–A04, preservando os contratos de
autorização, consentimento, salas privadas e prova de denúncia. Base confirmada:
`5fcd34b4eaa6b5cd4fa8681817128a4c6bdfb33f`, branch
`fix/unider-functional-recovery`, pasta principal Unider. A árvore já continha
as alterações candidatas da sequência; foram preservadas. Esta entrega não
abrange A05 e ainda exige aceitação e gates finais da Coordenação.

## Comportamento e ficheiros

- **A01:** a migration nova
  `supabase/migrations/20261006141924_secure_suggestions_and_match_intents.sql`
  revoga escrita de tabela e de todas as colunas para PUBLIC/anon/authenticated;
  concede apenas INSERT de `user_id`/`suggestion` ao utilizador autenticado,
  com RLS de identidade e aprovação falsa. Aprovação administrativa e SELECT
  de sugestões aprovadas continuam possíveis. A regression injeta permissões
  prévias amplas, incluindo colunas, antes de aplicar a migration.
- **A02:** a mesma migration regista intenções privadas UUID/dia, serializa match
  e cancelamento pelo lock transacional existente e conserva um marcador de
  cancelamento antes do primeiro find. Cancelar fecha a sala associada e termina
  as intenções de ambos os participantes. Intenções antigas não fecham a sala
  de uma intenção posterior; `leave_room` também termina as intenções da sala.
  O dia servidor rejeita replay mesmo depois da limpeza dos marcadores antigos.
  `src/lib/matchIntent.ts`, `src/store/chatStore.ts`, `src/lib/lobbyQueue.ts`,
  `src/hooks/useChatSession.ts`, `src/pages/Chat.tsx`, `src/pages/Lobby.tsx` e
  `src/store/authStore.ts` propagam UUID/dia e suspendem respostas automáticas
  logo no início da saída. Falha conserva a suspensão para retry após refresh.
- **A03:** `src/lib/chatHistory.ts`, `src/pages/Chat.tsx` e
  `supabase/functions/get-room-messages/handler.ts` identificam mensagens por
  `(sender_id, id)`, em acordo com a deduplicação do envio. Um UUID igual usado
  pelos dois participantes conserva ambas as mensagens; retry do mesmo
  remetente conserva idempotência. Conteúdo contraditório da mesma chave ainda
  recusa o snapshot.
- **A04:** `leave_room` considera ausência real de sala sucesso idempotente,
  permitindo logout depois de purga. Uma sala existente de terceiro continua
  recusada; o cliente não converte erros de autorização ou rede em sucesso.

Regressões candidatas em `tests/database.test.mjs`, `tests/edge.test.cjs`,
`tests/chat-history-handler.test.cjs`, `tests/chat-history.test.cjs`,
`tests/chat-browser.test.cjs`, `tests/auth.test.cjs`, `tests/lobby.test.cjs` e
`tests/lobby-browser.test.cjs`. Foram terminadas as fixtures de
`tests/clock.test.cjs` com a intenção exigida pelo contrato; a expectativa antiga
de recuperar sala através da intenção do peer cancelada foi corrigida para
`cancelled`, pois a intenção é terminal para ambos. O plano de publicação está
em `docs/operations/release.md`; arquitetura/contratos candidatos acompanham o
comportamento e serão revistos na integração.

## Verificação executada

- `node --test --test-isolation=none tests/clock.test.cjs tests/database.test.mjs tests/auth.test.cjs tests/chat-history-handler.test.cjs tests/chat-history.test.cjs tests/edge.test.cjs tests/lobby.test.cjs`:
  **60 passaram, zero falhas, dois excluídos** (concorrência PostgreSQL).
- `node --test --test-isolation=none tests/chat-browser.test.cjs tests/lobby-browser.test.cjs`:
  **17 passaram, zero falhas/exclusões**. Chromium 154.0.8037.95, 390×844,
  componentes/hooks/stores reais, serviços simulados e zero pedidos externos.
  Abrange match/cancelamento nas duas ordens de resposta, cancelamento pendente
  ou falhado com refresh/retry, colisão de UUID e respostas antigas.
- `deno check --frozen-lockfile --cached-only` para as entradas das quatro
  Functions: **passou** sem alterar o lockfile ou obter dependências novas.
  A primeira tentativa Deno teve acesso negado pelo sandbox; a primeira
  tentativa browser teve `ERR_NETWORK_ACCESS_DENIED` em localhost. As repetições
  locais autorizadas acima passaram.
- A matriz A01 foi depois ampliada para inspecionar todas as permissões de
  escrita de tabela/coluna. A repetição
  `node --test --test-isolation=none tests/database.test.mjs tests/documentation.test.cjs`:
  **17 passaram, zero falhas, dois excluídos** (concorrência PostgreSQL),
  incluindo os links locais dos documentos.

`npm test`, `npm run lint`, `npm run build` e concorrência PostgreSQL reais ficam
para a Coordenação após integrar A05, conforme atribuição. Não são considerados
aprovados por esta entrega. O cluster descartável preparado para essa verificação
não é a base da aplicação e não foi usado nesta entrega Backend.

## Limites, operação e entrega

Atualização da Coordenação, 08/10: candidato A01–A04 aceite após revisão
independente. As regressões SQL foram executadas também em PostgreSQL 18.6
local descartável: 18 passaram, zero falhas/exclusões, incluindo ambos os testes
concorrentes. O cluster foi desligado após a execução. Gates integrados após A05
e limitações alojadas na [entrega final](2026-10-08-findings-fixes.md).

PGlite prova as ordens determinísticas e permissões SQL, não concorrência.
Mocks não provam Auth/JWT, Realtime, Lua/Upstash ou serviços alojados. É necessário
validar publicação compatível de migration, Function e frontend em ambiente
autorizado; clientes antigos sem argumentos deixam de conseguir entrar/cancelar.
Não restaurar permissões inseguras nem RPCs antigos para contornar a falha.

Foram usadas as skills Supabase (documentação atual de privilégios/RLS) e
codex-coordinator (quadro lido, único escritor, sem UUID/claim inventados).
O changelog Markdown não pôde ser obtido neste ambiente; a documentação relevante
foi consultada pelo conector Supabase. Nenhuma alteração remota, migration
alojada, deploy, conta, email, configuração, compra, commit ou push foi realizado.
O diff está na árvore local da branch indicada. A entrega termina com revisão
da Coordenação; não inicia a área seguinte autonomamente.
