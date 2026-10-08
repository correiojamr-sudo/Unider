# U02 — Saída e recuperação da conversa

Data: **2026-10-05**. Pasta local Unider, branch `main`.
Base: `07c8bb2d529b2968317442b7dc8e13a09b537908` + diff U01 aceite pela
Coordenação + documentação preexistente da Coordenação. Entrega em diff local,
sem commit, push, merge ou deploy. **Nenhuma alteração remota.**

## Objetivo e comportamento

Corrigir F05/F06 da [auditoria funcional](2026-10-05-site-audit.md), preservando
U01, contratos, UUID de retry, políticas privadas e prazos/votos do servidor.

- «Sair para o Lobby» fica disponível com sala em loading, ativa, decisão,
  fecho ou erro; a fila sem sala mantém «Voltar ao Lobby».
- A saída normal chama `leave_room`/`leave_matchmaking` e só limpa contexto
  depois de resposta sem erro. `data: null` é aceite para os RPCs void.
- Falha mantém sala, mensagens e retry. Se o pedido falha ou fica pendente,
  há uma opção explícita «Voltar ao lobby sem confirmar fecho». O aviso informa
  que limpa contexto/espera local, não confirma fecho nem guarda uma denúncia
  pendente. Esta opção faz reset apenas do separador e impede reentrada
  automática no lobby; não altera prova servidor.
- `42501`, erros Auth PostgREST e HTTP 401/403/404/410 classificam recusa de
  acesso/conta/recurso, sem concluir que a sala terminou. Recusa para o polling
  automático e permite confirmação manual. Falha de ligação, timeout ou
  HTTP 408/409/429/5xx permite retry; erro/resposta desconhecidos permanecem
  não confirmados. O texto genérico «Room unavailable» não determina o estado.
- Estado de sala é validado pelo ID, tipos e datas esperados. Sem confirmação
  recente não há envio nem prolongamento; uma falha não limpa silenciosamente
  a sala. RPCs/Functions cliente têm timeout configurado de 10 segundos.
- Falha de denúncia mostra «Denúncia não confirmada» e conserva o mesmo roomId
  para retry. Não afirma suspensão depois de erro de Auth, autorização, lock,
  persistência ou ligação. Só `success: true` permite limpar contexto/navegar.
- `contextVersion` invalida respostas ao mudar proprietário, sala, intenção de
  fila ou reset. Protege também reset seguido dos mesmos IDs antes de um render.
  A instância do chat é remontada nessas transições. Respostas tardias de
  polling, envio, denúncia, saída, extensão e broadcasts não alteram o novo contexto.
- Retry de envio do mesmo texto na mesma instância mantém UUID; confirmação
  valida ID, remetente, texto e timestamp antes de adicionar a mensagem.
- «Passar»/«Novo Chat» exigem hora servidor recente antes de 22:48, verificada
  no início e após a saída. Se a saída atravessa 22:48, regressa ao lobby sem
  ativar a fila. Uma sala válida mantém os seus prazos até ao fecho permitido.

## Ficheiros desta entrega

- `src/pages/Chat.tsx`
- `src/hooks/useChatSession.ts`
- `src/store/chatStore.ts`: apenas contador do contexto; mantém campos/regras U01
- `src/lib/chatSession.ts`: validação de RoomState, sem mudar o formato servidor
- `src/lib/chatRecovery.ts`, `src/lib/chatOperations.ts`
- `tests/chat-recovery.test.cjs`, `tests/chat-browser.test.cjs`
- `docs/architecture.md`, `docs/contracts.md`, este registo

São **11 ficheiros**. Lobby, login/Auth, SQL, Functions, dependências/lockfiles e
`docs/project-status.md` não foram alterados por U02. A documentação da
Coordenação e o diff U01 foram preservados. A claim desta área usa apenas o helper.

## Verificação executada

Node **24.19.0**, dependências existentes. O npm fora do PATH foi executado pelo
CLI já disponibilizado pela Coordenação, mantendo o diretório de trabalho Unider:

```powershell
$uniderNpmCli = 'C:/Users/joaoa/Documents/Codex/2026-10-02/code-review-plugin-code-review-openai/work/tools/npm/package/bin/npm-cli.js'
$env:UNIDER_TEST_PLAYWRIGHT = 'C:/Users/joaoa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:UNIDER_TEST_BROWSER = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node $uniderNpmCli test
node $uniderNpmCli run lint
node $uniderNpmCli run build
```

| Gate sobre U01 + U02 | Resultado real |
| --- | --- |
| `test`, runner padrão com isolamento e ambos os browsers | **46 passaram, 0 falharam, 1 excluído**, exit 0. |
| Concorrência PostgreSQL | Excluída: PGlite de ligação única; sem base PostgreSQL descartável configurada. |
| `lint` | Exit 0, sem avisos. |
| `build` | TypeScript/Vite, exit 0; aviso de chunk JS **545,25 kB** acima de 500 kB. |
| `git diff --check` | Sem erros de whitespace. |

Foi usada a escalada específica já necessária para subprocessos locais do
runner/browser/Vite. Nenhuma instalação ou alteração de dependências.

Os seis testes novos de lógica exercitam classificação estruturada, mensagens
de denúncia, validação de RoomState, contexto/versão e efeitos assíncronos
confirmados/recusados/tardios. As regressões existentes de prazos, prolongamento,
deduplicação, stores e U01 continuam no gate completo.

O fixture de chat usa **Chrome/Chromium 154.0.8037.95**, viewport **390×844**,
React StrictMode, componentes Chat/Lobby, hooks e Zustand reais. O cliente
Supabase/Auth é substituído em memória; pedidos HTTP fora da origem local são
bloqueados. A execução verificou **zero pedidos externos e zero erros de página**.
O fixture tem cache Vite distinta da de U01. Sete cenários de browser passaram:

1. Refresh de sala persistida sem estado confirmado e espera de fila: saída
   normal confirma o RPC correto e limpa sala/fila.
2. Recusa, resposta malformada/desconhecida e ligação offline simulada: envio
   bloqueado; saída recusada/falhada conserva sala/mensagens; saída local
   explícita recupera o lobby sem fila; confirmação manual recupera erro transitório.
3. Envios falhado e repetido usam o mesmo UUID. Denúncias 401/403/409/503
   mantêm sala/mensagens e não afirmam suspensão. Retry confirmado regressa ao lobby.
4. Saída na decisão/fecho, voto confirmado, Novo Chat antes de 22:48, bloqueio
   a partir de 22:48 e pedido de saída que atravessa esse limite.
5. Envio/denúncia/saída/extensão antigos e broadcasts antigos após substituir
   sala; envio antigo após mudar proprietário, com o mesmo roomId.
6. Polling antigo depois de nova sala ou cancelamento da fila não repõe contexto
   nem navega a partir do lobby.
7. Denúncia pendente permite saída local; a conclusão antiga é ignorada. Reset
   seguido do mesmo roomId/proprietário invalida a resposta antiga pela versão.

Foi inspecionada uma captura a 390×844 com falha de denúncia: relógio, saída
normal, botão de retry, mensagens, erro, aviso de recuperação, saída local e
campo de envio legíveis. Não foi observado corte horizontal nesse cenário.

## Reprodução e limites

Executar os comandos acima com as ferramentas já instaladas. Sem
`UNIDER_TEST_PLAYWRIGHT`, os testes de browser são explicitamente excluídos.
Para executar apenas U02: `node --test tests/chat-recovery.test.cjs tests/chat-browser.test.cjs`
com as mesmas variáveis. O servidor do fixture escuta apenas em `127.0.0.1` e
servidor/browser fecham no fim. Não apontar o fixture aos serviços da aplicação.

- Os cenários de browser simulam respostas e falhas de transporte. Não provam
  JWT, Auth, Realtime, Redis, SMTP ou saída/denúncia no alojamento real.
- PGlite e mocks não provam concorrência PostgreSQL. Não foi feito type-check
  Deno porque não há alteração em Functions.
- `42501` não distingue membership, conta, consentimento ou sala eliminada;
  a interface apresenta recusa sem inventar uma causa mais específica.
- Sair localmente não cancela um efeito já aceite pelo servidor. A sala pode
  continuar até o ciclo servidor a encerrar; a denúncia pendente pode ainda
  concluir. Nenhum desses resultados é apresentado como confirmado.
- O UUID pendente permanece em memória da instância, como antes. Não há promessa
  nova de retry persistido após refresh ou recuperação de mensagens em falta;
  essa integração continua no âmbito de U04.
- Retenção, TTL e prova servidor permanecem iguais. A tentativa de denúncia
  tem de ocorrer dentro da janela que o servidor verifica.

Referências consultadas: [erros das Functions](https://supabase.com/docs/guides/functions/error-handling),
[invoke](https://supabase.com/docs/reference/javascript/functions-invoke),
[RPC](https://supabase.com/docs/reference/javascript/rpc) e tipos do SDK instalado
para `abortSignal`/timeout. Não foi acrescentada API nem alterado contrato servidor.

Entrega pronta para revisão. A área liberta a sua claim e não inicia U03.
