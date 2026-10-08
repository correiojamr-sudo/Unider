# Entrega integrada A01–A05 — 08/10/2026

## Resultado e base

As cinco correções foram implementadas e aceites localmente sobre
`5fcd34b4eaa6b5cd4fa8681817128a4c6bdfb33f`, na branch
`fix/unider-functional-recovery`, para atualizar o [PR #8](https://github.com/correiojamr-sudo/Unider/pull/8).
Houve uma área escritora de cada vez: Backend e Segurança, depois Produto e
Interface, com revisão antes da passagem e verificação final da Coordenação.
Não certifica ausência de outros problemas ou prontidão para abertura.

## Correções e regressões

| Item | Fronteira corrigida | Evidência local |
| --- | --- | --- |
| A01 | INSERT só de autoria/texto; aprovação exclusivamente administrativa | O INSERT autoaprovado reproduz antes da migration e é recusado depois; NULL, upsert, impersonação e grants herdados também recusados. INSERT pendente e aprovação serviço continuam possíveis. |
| A02 | Intenção UUID/dia persistida, cancelamento terminal e lock servidor | Cancelamento antes/depois de match, pedido atrasado, retry, refresh e cancelamento antigo após nova sala; transações concorrentes PostgreSQL. |
| A03 | Identidade `(sender_id, id)` em histórico, fusão e chave React | Dois participantes enviam o mesmo UUID, ambos ficam visíveis e snapshot funciona; retry do mesmo remetente continua idempotente. |
| A04 | Saída idempotente de sala realmente ausente | Ausência permite logout; sala existente de terceiro e falha de transporte continuam recusadas, preservando sessão. |
| A05 | Timeout de 10 s, cancelamento e guards de sessão/pedido | SDK real com fetch injetado e browser mantêm pedidos pendentes até expirar; retry preserva texto, sem POST automático; respostas antigas não alteram nova operação/sessão. |

Detalhes e ficheiros nas entregas [Backend A01–A04](2026-10-08-backend-findings-fixes.md)
e [Produto A05](2026-10-08-lobby-request-fixes.md). A revisão original permanece
no [registo de problemas](2026-10-05-open-findings.md), com a base histórica.

A01 passou investigação independente antes do candidato e revisão independente
de bypass/regressões depois. A Coordenação confirmou os contratos e testes;
nenhum bypass concreto remanescente foi encontrado no âmbito A01–A04. A skill
de correção de vulnerabilidades orientou essa sequência; as skills Supabase
orientaram permissões mínimas, RLS, migration nova e compatibilidade.

## Verificação final

- `npm test`, com `UNIDER_TEST_PLAYWRIGHT`/`UNIDER_TEST_BROWSER` configurados:
  **101 passaram, zero falhas, dois excluídos**. As cinco fixtures Chrome
  foram executadas, com pedidos externos bloqueados. Os dois excluídos são
  transações concorrentes, impossíveis na conexão única de PGlite.
- `UNIDER_TEST_DATABASE_URL` apontou exclusivamente para uma base nova
  `unider_review` no loopback, isolada das bases da aplicação.
  `node --test tests/database.test.mjs`: **18 passaram, zero falhas/exclusões**,
  em PostgreSQL **18.6**, incluindo 32 pedidos de matchmaking sobrepostos e
  12 rondas de cancelamento/find/peer concorrentes. Auth/Cron do harness continuam
  stubs; esta execução não prova Supabase alojado. O cluster foi desligado.
- `npm run lint`: passou, sem avisos.
- `npm run build`: passou, TypeScript/Vite; chunks JS 223,46 e 343,70 kB.
  Usou `https://unider-build.invalid` e chave sintética pública explícita.
  O `dist` **não é publicável**.
- `deno check --frozen-lockfile --cached-only` nas entradas de `send-message`,
  `report-room`, `get-room-messages` e `get-server-time`: passou.
- `git diff --check`: passou. Teste dos links documentais repetido após
  atualização final dos guias.

O primeiro gate detectou fixtures antigas sem intenção de fila e uma expectativa
SQL incompatível com cancelamento terminal. Foram corrigidas e repetidas.
O gate com todos os browsers detectou ainda ausência de `abortSignal` no mock
de acessibilidade: acrescentou-se apenas a interface do SDK, sem remover
asserções ou ampliar timeouts. A repetição completa passou.

## Publicação e limites

O PR recebe commit com prefixo `[CF-Pages-Skip]`, sem merge ou deploy.
O resultado do CI GitHub da nova revisão deve ser confirmado separadamente;
os testes PostgreSQL locais usam 18.6, enquanto o workflow usa PostgreSQL 17.
Não apresentar aprovação local como aprovação do CI ou dos serviços alojados.

Nova migration: `20261006141924_secure_suggestions_and_match_intents.sql`.
Não foi aplicada no Supabase alojado. As assinaturas antigas dos RPCs de fila
foram removidas no candidato: cliente e schema têm de ser publicados juntos,
seguindo o [plano de operação](../operations/release.md), sem reaplicar os três
SQL históricos sobre o bootstrap consolidado. O histórico de serviços U04/U06
exige também publicar as quatro Functions antes do respetivo frontend.

Nenhuma alteração de segredos, dados alojados, inscrições, contas, emails,
configuração, merge ou deploy foi realizada nesta sequência. Continuam por
validar Auth/SMTP reais, canais privados A/B/C, broadcasts recusados,
Functions/Redis concorrentes, falhas de persistência, ban/eliminação e Cron
alojados, na [matriz existente](2026-10-05-integration-readiness.md).

Abort de sugestão não garante rollback: um envio explícito posterior pode
duplicar uma sugestão já recebida. Não se introduziu deduplicação servidor de
sugestões; o formulário indica que o envio ficou por confirmar. Timeouts do
browser medem tempo ativo e podem concluir apenas ao retomar um separador suspenso.
