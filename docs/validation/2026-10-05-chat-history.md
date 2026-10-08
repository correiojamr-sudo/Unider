# U04 — recuperação de mensagens após reconexão

## Objetivo e base

Recuperar mensagens ainda disponíveis no buffer após subscrição/reconexão,
sem perder broadcasts intercalados, alterar retenção ou aplicar respostas
antigas a outro contexto. Base: `main`, HEAD
`07c8bb2d529b2968317442b7dc8e13a09b537908`, com alterações locais U01–U03 aceites.
O diff contra HEAD inclui também essas alterações anteriores, preservadas.

## Reprodução e comportamento

Antes da alteração de produção, a fixture de browser interrompeu o canal,
colocou uma mensagem do colega apenas no buffer simulado e voltou a emitir
`SUBSCRIBED`. A mensagem não apareceu e não houve pedido de histórico: R01
reproduzido. O teste final mantém o mesmo cenário e exige que a mensagem apareça.

O cliente instala a receção antes de pedir `get-room-messages`, uma vez por
transição para `SUBSCRIBED`. A fusão usa o estado atual, deduplica por ID e ordena
por timestamp/ID, conservando mensagens conhecidas. Uma interrupção cancela o
pedido e invalida a sua geração; troca de utilizador/sala/contextVersion ou
desmontagem descarta sucesso, erro e finalização antigos. Retry é manual,
sem polling novo. Erro e histórico parcial são apresentados explicitamente;
a leitura pendente não bloqueia saída ou denúncia.

A Function verifica `auth.getUser` com JWT e UUID da sala, usa o lock comum,
autoriza como `message` antes e depois da leitura e valida participantes/dados.
Lua verifica o token e lê no máximo 200 entradas (`LRANGE 0 199`), recusando
buffers maiores. Só lê `GET`, `LLEN`, `LRANGE`; não escreve ou renova TTLs de
mensagens/deduplicação. Lock ocupado/perdido é 409; conteúdo inválido/falha de
serviço é 503, nunca lista vazia simulada. `partial: true` é obrigatório mesmo
quando o buffer vazio/expirado devolve zero mensagens. Não há garantia de
recuperação após fecho, decisão, perda de autorização ou expiração.

## Ficheiros U04

- Cliente: `src/pages/Chat.tsx`, `src/store/chatStore.ts`,
  `src/hooks/useChatHistory.ts`, `src/lib/chatHistory.ts`.
- Servidor: `supabase/functions/get-room-messages/handler.ts` e `index.ts`.
- Regressões: `tests/chat-browser.test.cjs`, `tests/chat-history.test.cjs`,
  `tests/chat-history-handler.test.cjs`.
- Type-check CI: `.github/workflows/review-regressions.yml`.
- Guias: `docs/architecture.md`, `docs/contracts.md`, `docs/development.md`,
  `docs/operations/release.md` e este relatório.

Não houve alteração U04 a Auth, `_shared`, migrations, configuração Supabase,
dependências ou lockfiles. A adaptação autorizada do mock/expectativa do lobby
pertence à entrega U03 e foi preservada.

## Verificação observada em 2026-10-05

Node 24.19.0, Chromium 154.0.8037.95, viewport 390×844, npm CLI/runtime existentes.
Browser monta componentes/hooks/store reais em StrictMode, substitui os serviços
e bloqueia pedidos fora da origem local. Nenhuma ferramenta foi instalada.

| Comando/cenário | Resultado real |
| --- | --- |
| `node --test tests/chat-history.test.cjs tests/chat-history-handler.test.cjs tests/chat-browser.test.cjs` durante implementação | 19 passaram, 0 falhas, antes dos três cenários de browser adicionais. |
| `node --test tests/chat-browser.test.cjs` final | 12 passaram, 0 falhas; perda/reconexão, snapshot + broadcasts, retry/recusa, saída/denúncia pendentes e respostas antigas. Zero pedidos externos/erros JavaScript. |
| `npm test` com runtime browser existente, execução final | 71 testes: 70 passaram, 0 falhas, 1 omitido (concorrência PostgreSQL; PGlite). Auth/lobby/chat incluídos. |
| `npm run lint` | Código de saída 0, sem avisos. |
| `npm run build` | TypeScript/Vite passaram; aviso de chunk >500 kB: JS 556,66 kB, gzip 162,33 kB. |
| `deno check --frozen-lockfile --cached-only supabase/functions/send-message/index.ts supabase/functions/report-room/index.ts supabase/functions/get-room-messages/index.ts` | As três Functions passaram; cache existente, sem regenerar `deno.lock`. |
| `node --test tests/documentation.test.cjs` após os guias/relatório | Links locais verificados separadamente após a documentação final. |
| `git diff --check` | Sem erros de whitespace; avisos Git de normalização CRLF/LF em ficheiros já alterados. |

O primeiro gate conjunto teve 69 passes, 1 falha por timeout de 5 segundos no
teste do lobby ao esperar o botão de entrada, e 1 omitido. O lobby passou depois
isoladamente e o gate conjunto passou na repetição, sem alterar a fixture ou
produto para ocultar esse timeout. A causa não foi confirmada; fica como
instabilidade observada da execução local. Os testes U04 passaram em ambas.

## Limites, riscos e operação

Mocks de Auth/RPC/Redis comprovam os caminhos do handler e a inspeção do script,
não execução Lua/concorrência, JWT, Realtime ou TTLs de serviços alojados. PGlite
não comprova concorrência PostgreSQL. A validação real de reconexão, revogação,
buffer expirado e retenção/prova continua a exigir ambiente e sessões autorizados.
Não se usou Supabase, Redis nem dados reais da aplicação neste harness.

O script segue as garantias documentadas de
[execução atómica Lua](https://redis.io/docs/latest/develop/programmability/eval-intro/)
e a leitura inclusiva de
[LRANGE](https://redis.io/docs/latest/commands/lrange/).
A verificação JWT segue a
[documentação oficial de Auth em Functions](https://supabase.com/docs/guides/functions/auth).

Nenhuma mudança remota, deploy, migration, conta, segredo, compra ou abertura de
registos. Publicar a nova Function e validar o contrato servidor antes do
frontend, apenas com autorização específica; ver
[ordem de lançamento](../operations/release.md). Não reaplicar o bootstrap ou
as migrations históricas. Cancelar um pedido cliente não desfaz ações servidor
já recebidas. A leitura utiliza o mesmo lock, pelo que pode receber 409 enquanto
há envio/denúncia em curso; o retry manual conserva mensagens e não renova TTLs.

Branch/HEAD mantidos, índice vazio, sem commit: alteração disponível no diff
local e ficheiros novos. Entrega limitada a U04; aguardar revisão antes de U05.
