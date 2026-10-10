# Revisão complementar — 08/10/2026

## Âmbito e resultado

[Certain] Base: `d32f451fcca016ca8753b56da94f1b1587d61579`, branch
`fix/unider-functional-recovery`, árvore limpa no início. Pedido: procurar
erros, incongruências e desorganização; registar, sem corrigir nesta ronda.

Um problema funcional reproduzido (B01, P2) e um ponto de organização confirmado
(O01, P3). Não são uma reabertura dos cinco problemas A01–A05 já corrigidos.
Foram revistos os fluxos de sessão, lobby/fila, conversa, recuperação, Functions
e o estado final das quatro migrations. Não se declara ausência de outros erros.

## B01 — P2: o prazo de denúncia depende de quando alguém consulta a sala

[Certain] Em
[`refresh_room`](../../supabase/migrations/20261002231850_secure_chat_lifecycle.sql),
linhas 68–78, o encerramento automático guarda `ended_at = now()` quando deteta
timeout ou heartbeat expirado. Não guarda a hora efetiva do limite ultrapassado.
No mesmo ficheiro, `authorize_room`, linhas 194–201, chama primeiro esse helper
e calcula depois a denúncia até
`least(hard_close_at, coalesce(ended_at, expires_at)) + interval '5 minutes'`.
A migration incremental posterior não substitui estas funções.

Consequência: depois de ambos os participantes deixarem de consultar a sala,
voltar mais tarde pode atribuir-lhe um fim artificialmente recente e abrir uma
janela de denúncia que já estaria fechada se o polling tivesse continuado.
Não é necessário alterar o relógio do browser nem falsificar identidade.
O limite absoluto `hard_close_at + 5 minutos` mantém-se: o problema não concede
acesso ilimitado nem permite denunciar salas de terceiros.

### Reprodução local e controlo negativo

[Certain] Executada em PGlite, exclusivamente em memória, reutilizando a
preparação de [database.test.mjs](../../tests/database.test.mjs): roles, stubs
Auth/Cron, quatro migrations, quatro participantes elegíveis e relógio SQL
injetado no teste. Nenhum SQL foi enviado à base da aplicação.

Dois pares distintos, cada um com a sua sala, mesmos prazos e heartbeats:

- `expires_at`: 02/10/2026 às 22h32, Lisboa (`21:32:00Z`).
- Fim da decisão inicial: 22h32m30s; `hard_close_at`: 22h50.
- Últimos heartbeats: 22h31m50s, para que o timeout da decisão ocorra primeiro.
- Sala A: `get_room_state` às 22h32m31s; sala B: nenhuma consulta nesse momento.
- Às 22h44, `authorize_room(..., 'report')` pelo serviço, para o participante
  correto de cada sala, em transações separadas.

Resultado observado:

| Caso | Resultado às 22h44 |
| --- | --- |
| A, consultada junto do fim | Recusa `42501`, `Report window expired`. |
| B, consultada apenas mais tarde | Aceite; `ended_at = 21:44:00+00:00`, apesar de `expires_at = 21:32:00+00:00`. |

Ambas as asserções passaram. A diferença vem da hora da consulta, não de
diferenças de autorização ou dos prazos originais. O teste comprova a decisão
SQL; não comprova entrega Realtime, conteúdo Redis ou persistência alojada.

### Próxima tarefa e aceitação

[Likely] Backend e Segurança deve fixar uma hora efetiva determinística para
encerramentos automáticos e usá-la no prazo de denúncia. Preservar encerramentos
explícitos, extensão única, membership, bans, idempotência e o limite absoluto.
Usar migration nova; não editar migrations já aplicadas.

Critério: duas salas equivalentes têm o mesmo limite de denúncia, com ou sem
polling, incluindo timeout inicial, extensão, heartbeat e fecho absoluto.
Denúncias dentro do prazo continuam possíveis e retries não o prolongam.
Confirmar também a fronteira exata antes/depois do limite. Não implementado.

## O01 — P3: restos do template sem ligação à aplicação

[Certain] [`src/App.css`](../../src/App.css) conserva estilos do template
(`counter`, `hero`, `next-steps`) mas não é importado. O arranque em
[`src/main.tsx`](../../src/main.tsx) usa `index.css`; a pesquisa dos imports e
referências no código não encontrou utilização de `App.css`, nem de
`src/assets/hero.png`, `src/assets/react.svg` e `src/assets/vite.svg`.

É dívida de organização, não uma falha demonstrada para utilizadores nem um
problema de segurança. Não se atribui impacto no tamanho do bundle sem medição.

[Likely] Numa tarefa de limpeza, confirmar novamente as referências e remover
apenas estes restos; validar build e aparência. Não aproveitar para mudar
dependências, lockfiles ou a plataforma Pages. Nada foi removido nesta revisão.

## Verificações, limites e entrega

[Certain] A reprodução SQL dirigida passou, com o caso aceite e o controlo
recusado. A inspeção de referências confirmou o ponto de organização. O teste
dos links documentais e `git diff --check` passaram após guardar este relatório.
Não se repetiram os gates completos de código: não houve alterações ao código.
Os resultados anteriores permanecem na
[entrega A01–A05](2026-10-08-findings-fixes.md), sem os apresentar como testes
novos desta ronda.

Não se testou a app publicada nesta revisão. Não houve deploy, migration
alojada, alteração de contas/segredos/dados, commit, push ou alteração do PR.
As skills Supabase e de coordenação orientaram a separação entre prova local
e serviços reais e limitaram a escrita aos documentos. Os serviços alojados
continuam sujeitos à [matriz de validação](2026-10-05-integration-readiness.md).

Alterações locais: este relatório, ligação no índice e resumo no estado do
projeto. B01/O01 ficam por tratar; nenhuma correção foi aplicada.

## Correção B01 — validação local

[Certain] Após a revisão, o proprietário pediu a correção de B01. A reprodução
e o resultado acima são o registo histórico da auditoria; B01 está agora
corrigido no diff local. O01 não foi alterado.

Nova migration, gerada pela CLI instalada e preenchida sem editar histórico:
[`20261008181527_deterministic_room_end.sql`](../../supabase/migrations/20261008181527_deterministic_room_end.sql).
O helper privado calcula o primeiro limite entre `ended_at`, fecho absoluto,
prazo da sala (com os 30 segundos de decisão apenas antes da extensão) e o menor
heartbeat + 45 segundos. `refresh_room` guarda esse fim efetivo, limitado à hora
atual no caso de perda de elegibilidade anterior aos prazos. `authorize_room`
usa o mesmo cálculo para denunciar, incluindo linhas com um `ended_at` tardio
gravado pelo código anterior. Não altera histórico, transcrições, TTLs ou
permissões cliente; os RPCs de serviço continuam exclusivos do serviço.

A regressão acrescentada em [database.test.mjs](../../tests/database.test.mjs)
falhou antes da correção e passou depois. Cobre decisão inicial, extensão,
heartbeat, fecho absoluto e saída explícita anterior aos limites. Compara
consulta junto do fim e consulta 12 minutos depois; verifica denúncia 1 ms
antes, exatamente no limite de cinco minutos e 1 ms depois. Recusas repetidas
antes de guardar o encerramento comprovam que rollback/retry não desloca o
limite. Um caso adicional recusa uma linha com encerramento tardio antigo.
As regressões existentes de denúncia/persistência, ban, eliminação, prova e
emparelhamento continuam a passar.

Resultados novos desta correção:

- `npm test` com todas as cinco fixtures Chrome isoladas: **102 passaram,
  zero falhas, dois excluídos** (concorrência em PGlite).
- `node --test tests/database.test.mjs` numa base `unider_review` nova,
  exclusivamente em loopback, PostgreSQL **18.6**: **19 passaram, zero falhas
  ou exclusões**, incluindo os dois casos concorrentes. Cluster desligado.
- `npm run lint`: passou.
- `npm run build`: passou, com configuração pública sintética; o `dist` não é
  publicável. Vite emitiu apenas um aviso informativo de tempo dos plugins.
- `deno check --frozen-lockfile --cached-only` nas quatro entradas: passou.
- Links documentais e `git diff --check`: passaram.

Alterações: migration nova, regressão SQL, contrato, plano de lançamento,
estado, índice e este relatório. Base continua `d32f451`, branch original;
preservaram-se os três documentos locais da revisão anterior. Nenhum commit,
push, merge, deploy ou operação sobre dados/segredos/contas alojadas.

A correção só entra em funcionamento no serviço após aplicar a migration
nova no ambiente autorizado. Por si só não requer alterações nas Functions
ou Pages; a publicação das correções A01–A05 mantém os seus próprios requisitos
de compatibilidade. Ver [operação](../operations/release.md).
