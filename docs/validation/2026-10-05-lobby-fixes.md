# U01 — Fila, horários e sugestão no lobby

Data: **2026-10-05**. Ambiente: pasta local Unider, branch `main`.
Base: `07c8bb2d529b2968317442b7dc8e13a09b537908`; entrega em diff local,
sem commit, push, merge ou publicação. Nenhuma alteração remota.

## Objetivo e alterações

Corrigir F01, F02, F03, F04 e F08 da
[auditoria funcional](2026-10-05-site-audit.md), com os contratos servidor intactos.

- A pré-fila usa `chatStore.isQueueing`, `ownerId` e `queueDay` em
  `sessionStorage`. Refresh conserva a intenção no mesmo dia. Cancelar remove-a;
  receber uma sala, reset ou mudar de proprietário também a limpa.
- Só há entrada automática pelo lobby entre 22:30 inclusivo e antes de 22:48,
  com intenção válida, utilizador atual, ausência de sala e consentimento
  confirmado. Consulta dos termos pendente, recusada ou falhada não autoriza
  navegação; falha de consulta permite tentar novamente.
- A pré-fila é apresentada como «Entrada preparada». Não afirma entrada numa
  fila servidor nem garante um par. O chat continua a pedir emparelhamento por RPC.
- A apresentação distingue abertura da pré-fila (22:28), início (22:30), fim
  dos novos pares (22:48) e fecho (22:50). Título, descrição e contagem referem
  o mesmo evento. Às 22:35 a contagem é `13:00`, para 22:48.
- Entre 22:48 e 22:50 não há nova entrada. A limpeza da intenção de espera não
  apaga sala, peer, mensagens ou votos. Uma sala guardada oferece «Voltar à conversa»;
  a sua validade é confirmada pelo fluxo existente do chat e pelo servidor.
- Foi removido o Presence público `campus-queue`; não foi criado outro canal,
  nem alteradas políticas ou configuração Realtime.
- A sugestão distingue confirmação, resposta de erro e exceção. Falha conserva
  texto, apresenta aviso e liberta loading. Mudança de utilizador/desmontagem
  invalida respostas antigas; o formulário atual não é limpo por um envio antigo.

Ficheiros desta tarefa:

- `src/pages/Lobby.tsx`
- `src/store/appStore.ts`, `src/store/chatStore.ts`
- `src/utils/time.ts`, `src/hooks/useTimeSync.ts`
- `src/lib/lobbySchedule.ts`, `src/lib/lobbyQueue.ts`, `src/lib/lobbySuggestion.ts`
- `tests/lobby.test.cjs`, `tests/lobby-browser.test.cjs`
- `docs/architecture.md`, `docs/contracts.md`, este registo

As alterações preexistentes da Coordenação em `AGENTS.md`, `docs/README.md`,
`docs/project-status.md`, auditoria e marcador do quadro foram preservadas e
não fazem parte desta entrega. A claim desta área é gerida apenas pelo helper.

## Verificação executada

Node **24.19.0**, dependências já existentes; nenhuma instalação ou alteração
de lockfile. `npm` não estava no PATH. Foi usado o CLI já disponível, apenas
como ferramenta, mantendo a pasta Unider como diretório de trabalho:

```powershell
$uniderNpmCli = 'C:/Users/joaoa/Documents/Codex/2026-10-02/code-review-plugin-code-review-openai/work/tools/npm/package/bin/npm-cli.js'
$env:UNIDER_TEST_PLAYWRIGHT = 'C:/Users/joaoa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:UNIDER_TEST_BROWSER = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node $uniderNpmCli test
node $uniderNpmCli run lint
node $uniderNpmCli run build
```

| Verificação | Resultado real |
| --- | --- |
| Gate `test`, runner padrão com isolamento | **32 passaram, 0 falharam, 1 excluído**. Inclui o browser isolado. |
| Concorrência PostgreSQL | **Excluído**: PGlite é de ligação única; sem PostgreSQL descartável configurado. |
| Gate `lint` | Exit 0; três avisos preexistentes `set-state-in-effect` em `Chat.tsx` e `useChatSession.ts`. Sem avisos no lobby. |
| Gate `build` | Exit 0, TypeScript e Vite; aviso de chunk JS de 540,12 kB acima do limiar de 500 kB. |
| `git diff --check` | Sem erros de whitespace. |

Tentativas sem escalada falharam com `spawn EPERM` no runner padrão e no build.
Após permissão específica da ferramenta, os comandos padrão concluíram; não
foi necessário substituir o runner final pelo modo sem isolamento. Os erros
iniciais de compilação e arranque duplicado do fixture de browser foram
corrigidos antes da execução final aprovada.

Os sete testes em `lobby.test.cjs` exercitam helpers e o middleware de persistência
Zustand real. Cobrem 22:27:59, 22:28, 22:29:59, 22:30, 22:35, 22:47:59, 22:48,
22:49:59 e 22:50 em dias de verão/inverno, as mudanças de hora de 29/03 e 25/10,
refresh, cancelamento, dia/proprietário diferente, contexto antigo sem data,
preservação de sala/mensagens/votos e respostas de sugestão.

O teste de browser correu em **Chrome/Chromium 154.0.8037.95**, viewport
**390×844**, React StrictMode, componente Lobby e hooks/stores reais. Auth e
Supabase foram substituídos em memória por fixtures; o teste bloqueia pedidos
HTTP fora da origem local e verificou zero pedidos externos e zero erros de página.
O fixture não importa o cliente Supabase real. Foram observados:

- Preparar a entrada, fazer refresh, cancelar e fazer novo refresh: sem entrada
  automática às 22:30 após cancelar.
- Preparar às 22:29:59, fazer refresh e avançar para 22:30: navegação para a rota
  de chat simulada após confirmação de termos.
- Limpar a store como numa saída concluída e voltar ao lobby: sem nova entrada.
- Texto e botões nos limites de novos pares/fecho; às 22:35 a contagem `13:00`.
- Sala guardada entre 22:48 e 22:50: acesso de retorno e mensagens preservadas.
- Termos pendentes após refresh: nenhuma navegação; aceitação recusada mantém
  o lobby; aceitação confirmada permite a entrada. Falha de consulta permite retry.
- Resposta de termos de um utilizador anterior não desbloqueia o utilizador atual.
- Recuperar foco às 22:48 atualiza o relógio e remove a nova entrada.
- Erro devolvido/exceção no envio de sugestão: texto mantido e retry disponível;
  sucesso confirmado limpa o campo; resposta antiga após mudar utilizador não
  altera o novo texto nem mostra sucesso. Sem overflow horizontal no cenário observado.

Foi inspecionada visualmente uma captura local do lobby diurno a 390×844:
título, contagem, descrição, formulário e rodapé legíveis, sem corte horizontal.

## Reprodução isolada

Com Playwright e browser já instalados, executar o comando `test` acima. Sem
`UNIDER_TEST_PLAYWRIGHT`, o teste de browser é explicitamente excluído; os sete
testes de lógica/persistência continuam no gate. O fixture cria um servidor Vite
apenas em `127.0.0.1`, usa uma sessão sintética e fecha servidor/browser no fim.
Não instalar bibliotecas nem apontar este fixture aos serviços da aplicação.

## Limitações e riscos restantes

- Contextos guardados pela versão antiga sem `queueDay` exigem preparar outra
  vez a entrada. Não é possível determinar em que dia foi criada a intenção
  antiga; não se assume que continua válida. Sala e mensagens antigas são preservadas.
- O relógio do dispositivo continua a orientar a apresentação. Os RPCs mantêm
  a autoridade de horário, identidade, consentimento e membership; desvio de
  relógio e integração alojada permanecem no âmbito de U06.
- O teste de browser simula respostas e a rota de destino do chat. Não prova
  emparelhamento, saída, Auth, Realtime, SMTP ou integração Redis/Functions reais.
- O INSERT de sugestão não tem contrato de idempotência. Se o servidor aceitar
  e a resposta se perder, retry pode duplicar a sugestão; não foi acrescentada
  uma garantia que o servidor não oferece.
- F05/F06 e os restantes problemas da auditoria permanecem fora de U01. Não
  foram alterados Chat, hook de sessão, login/Auth, SQL ou Functions.

Referências consultadas: [INSERT no cliente Supabase](https://supabase.com/docs/reference/javascript/insert)
para o resultado `{ error }`, [single](https://supabase.com/docs/reference/javascript/single)
e [changelog](https://supabase.com/changelog). Os contratos externos não foram alterados.

Entrega pronta para revisão da Coordenação. Esta área para após libertar a sua claim.
