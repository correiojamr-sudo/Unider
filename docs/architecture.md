# Arquitetura e mapa do código

## O que é a aplicação

O Aquecimento (anteriormente Unider) é uma SPA para conversas temporárias entre maiores de 18 anos com email
`@student.uc.pt`. React/TypeScript desenha a interface; Supabase fornece Auth,
PostgreSQL, RPCs, Realtime e Edge Functions; Upstash Redis conserva o buffer
temporário. Cloudflare Pages serve o frontend compilado em `dist/`.

Uma denúncia pode persistir o conteúdo disponível em PostgreSQL. “Efémero” não
significa que os textos nunca existam no browser ou em armazenamento temporário.
A especificação inicial previa PWA, mas este repositório ainda não inclui um
manifesto/service worker que demonstre essa funcionalidade completa.

## Onde está cada responsabilidade

| Caminho | Responsabilidade |
| --- | --- |
| `src/main.tsx` | Valida configuração antes de importar App; monta React ou diagnóstico recuperável. |
| `src/App.tsx` | Rotas, guardas de sessão e observação do estado Auth. |
| `src/pages/Login.tsx` | Email institucional, pedido OTP e verificação do código. |
| `src/pages/Lobby.tsx` | Contagem, sugestões, termos, espera e entrada no chat. |
| `src/pages/Chat.tsx` | Receção privada, envio, retry, extensão, denúncia e saída. |
| `src/components/modals/` | Termos e definições; não são páginas com rota própria. |
| `src/components/modals/ModalFrame.tsx`, `src/hooks/useModalAccessibility.ts` | Semântica de diálogo, foco, isolamento do fundo e reposição do foco. |
| `src/hooks/useChatSession.ts` | Polling RPC, relógio da sala e recuperação de estado. |
| `src/hooks/useChatHistory.ts`, `src/lib/chatHistory.ts` | Snapshot após subscrição, validação/fusão por remetente+ID e descarte de respostas antigas. |
| `src/hooks/useTimeSync.ts`, `src/lib/serverClock.ts` | Amostra autenticada de hora, RTT, validade/contexto e relógio monotónico do lobby. |
| `src/lib/chatSession.ts` | Tipo `RoomState` e cálculo puro da fase/tempo restante. |
| `src/lib/chatRecovery.ts`, `src/lib/chatOperations.ts` | Classificação estruturada de falhas e guardas de operações no contexto atual. |
| `src/lib/lobbySchedule.ts`, `src/lib/lobbyQueue.ts` | Eventos/contagens de Lisboa e guardas da intenção local de espera. |
| `src/lib/matchIntent.ts` | UUID/dia persistidos e argumentos do contrato de emparelhamento/cancelamento. |
| `src/lib/lobbySuggestion.ts` | Distingue confirmação de envio, resposta de erro e exceção. |
| `src/lib/lobbyRequest.ts` | Limita a espera de termos/sugestões e passa o cancelamento ao transporte SDK. |
| `src/lib/authOperations.ts`, `src/hooks/useAuthOperation.ts` | Normalização, erros públicos e guardas de operações de autenticação/consentimento. |
| `src/lib/authSession.ts` | Arranque de sessão, cliente Auth delimitado e confirmação de alterações no armazenamento. |
| `src/lib/supabase.ts` | Cliente público Supabase configurado pelas variáveis Vite. |
| `src/lib/publicConfig.ts`, `vite.config.ts` | Validação pública comum ao preflight de build, bootstrap e ambos os clientes Auth. |
| `src/store/authStore.ts` | Sessão, identidade e saída da conta. |
| `src/store/chatStore.ts` | Sala, mensagens e contexto por utilizador em `sessionStorage`. |
| `src/store/appStore.ts`, `src/utils/time.ts` | Modos/contagens de apresentação em Lisboa. |
| `supabase/migrations/` | Evolução do schema, RPCs, políticas e limpeza. |
| `supabase/functions/_shared/chat.ts` | Auth, autorização, Redis, broadcast e lock comuns. |
| `supabase/functions/*/handler.ts` | Operação de negócio testável por injeção de dependências. |
| `supabase/functions/*/index.ts` | Entrada Deno da Function. |
| `tests/` | Regressões de estado, handlers e base de dados isolada. |
| `tests/documentation.test.cjs` | Verifica links locais dos guias e instruções. |
| `.github/workflows/review-regressions.yml` | Gates com PostgreSQL 17 e type-check Deno. |
| `public/_redirects` | Fallback de rotas da SPA para `index.html`. |

## Fluxos essenciais

### Login e consentimento

`Login` pede/verifica OTP em Supabase Auth. `App` acompanha a sessão, e
`authStore` liga o contexto de chat ao utilizador. `Lobby` lê a versão dos termos
para esse utilizador e bloqueia entrada enquanto a consulta está pendente ou falha;
`TermsModal` chama `accept_terms('1.1')`. O servidor exige elegibilidade nas
operações sensíveis: sessão visual não substitui autorização.

O email é normalizado com `trim`/minúsculas e validado como endereço completo.
Só uma resposta Auth sem erro fixa o destinatário e permite introduzir OTP;
isso confirma o pedido, não a entrega de email. O formulário aceita 6–10 dígitos,
mostra o destinatário, permite corrigir o email e oferece reenvio explícito após
60 segundos. O servidor continua a impor validade, limites e disponibilidade.

`App` subscreve Auth antes da leitura inicial. Eventos ou uma revisão de sessão
mais recente vencem resultados/erros antigos de `getSession`; falha inicial
termina loading e apresenta retry. O contador Auth invalida respostas de login,
termos e definições quando muda a identidade, mesmo se esta for depois reutilizada.
Desmontagem, edição e substituição de uma operação invalidam também os seus callbacks.

O cliente Auth de cada operação usa o SDK instalado, um canal próprio e alterações
de armazenamento preparadas em memória. Só uma operação atual, sem erro e sem
substituição da sessão no armazenamento confirma essas alterações. Assim, um
`verifyOtp` tardio ou um `signOut` offline não escreve/remove a sessão principal.
As notificações entre separadores contêm apenas `changed`; `App` relê o estado
atual e descarta leituras ultrapassadas, em vez de receber uma sessão antiga.

Logout confirma primeiro saída da sala/fila e depois Auth. Falha mantém sessão,
contexto e erro recuperável, sem afirmar fecho remoto. Após eliminação confirmada
da conta, tenta apenas logout; o modal distingue conta eliminada de saída ainda
pendente. Nenhuma resposta antiga limpa o contexto de uma nova identidade.

### Emparelhamento e sala

Ao entrar, `chatStore.isQueueing` ativa `useChatSession`. O hook consulta
`find_or_join_match` até receber sala e peer; depois consulta `get_room_state`.
Os RPCs mantêm leases/heartbeats e devolvem hora/prazos do servidor. O frontend
calcula a apresentação, mas não altera esses prazos localmente.

A pré-fila do lobby é apenas intenção local: `isQueueing` e `queueDay` persistem
no `sessionStorage`, associados a `ownerId`. Refresh no mesmo dia mantém essa
intenção; cancelar, reset, mudar de proprietário ou receber uma sala limpa-a.
Sem data, noutro dia ou fora de 22:28–22:48, não há entrada automática no lobby.
Um contexto antigo sem `queueDay`/`queueIntent` exige preparar novamente a entrada. Não é
descartada uma sala guardada para limpar a fila.

`queueIntent` guarda um UUID e o dia servidor da entrada. Mantém-se após encontrar
sala para permitir cancelamento inequívoco. O servidor regista a intenção e a
sala encontrada; um cancelamento anterior ao primeiro pedido de entrada fica
registado e bloqueia esse pedido quando chegar. O dia servidor impede replay
de intenções antigas depois da limpeza periódica dos metadados. Uma entrada nova
usa outro UUID. Estes campos não substituem identidade JWT, termos ou horários.

Às 22:30, intenção válida e consentimento confirmado para o utilizador atual
permitem navegar para o chat, onde o RPC pede o emparelhamento. O lobby não cria
Presence nem canais públicos. A partir de 22:48 não oferece novos pares; uma
sala existente continua acessível e o seu prazo mantém-se no servidor.

Título, texto e contagem do lobby usam o mesmo evento: pré-fila às 22:28,
início às 22:30, fim dos novos pares às 22:48 e fecho às 22:50. `useTimeSync`
atualiza ao recuperar foco/visibilidade; ações verificam também o relógio atual.
U06 usa uma amostra autenticada de `get-server-time` em vez da hora do dispositivo:
RTT até 5 segundos, estimativa no instante de receção com metade do RTT e avanço
por `performance.now()`. A amostra pertence ao utilizador/revisão Auth, expira
aos 90 segundos e não é persistida. Consulta inicial, a cada 60 segundos quando
visível e ao recuperar foco/visibilidade, com mínimo de 10 segundos entre tentativas.
O segundo de atualização visual não gera pedidos de rede. Falha pode conservar
uma amostra ainda válida; sem confirmação recente não há nova entrada nem limpeza
da intenção de fila. É sempre possível cancelar a espera ou voltar à sala guardada.
`queueDay` é calculado da estimativa servidor; Novo Chat passa a data derivada do
último estado PostgreSQL, antes de limpar a sala. Os prazos das salas continuam
ancorados a `get_room_state`, nunca à Function de apresentação. Esta estimativa
não concede autorização e pode ter erro de rede/relógio entre camadas.

A leitura dos termos e o INSERT de sugestões têm um limite de 10 segundos,
definido por `AUTH_TIMEOUT_MS`. `lobbyRequest` combina timeout e controller de
cancelamento, passa o sinal ao SDK e termina a espera da interface mesmo se o
transporte continuar pendente. Falha na leitura disponibiliza «Verificar termos»;
uma revisão Auth nova volta a verificar consentimento, mesmo para o mesmo ID.

Uma sugestão só apresenta sucesso após resposta sem erro do INSERT. Erro,
exceção ou timeout mantém o texto e permite envio explícito posterior; não há
repetição automática do POST. A interface informa que a sugestão pode já ter
sido recebida: abortar não desfaz uma escrita servidor. Respostas antigas não
alteram o formulário nem a leitura dos termos após substituição de pedido,
desmontagem, mudança de utilizador ou revisão Auth. Renovar a sessão do mesmo
utilizador liberta o formulário e conserva o rascunho; mudar de utilizador
monta um formulário novo. Ver [validação A05](validation/2026-10-08-lobby-request-fixes.md).

### Saída e recuperação da conversa

O chat oferece saída normal em todas as fases, incluindo loading e erro.
Só limpa o contexto após confirmação sem erro de `leave_room` ou
`leave_matchmaking`. Se o pedido falha ou fica pendente, a opção explícita
«Voltar ao lobby sem confirmar fecho» limpa apenas o contexto do separador,
incluindo a intenção de fila; informa que não confirma fecho nem guarda uma
denúncia pendente. Falhas transitórias não descartam sala, mensagens ou retry.

Chat, cancelamento no lobby e logout suspendem a intenção antes de pedir
`leave_matchmaking` com UUID/dia; respostas de emparelhamento já emitidas deixam
de alterar a interface. Cancelamento falhado permanece suspenso e repetível após
refresh. A confirmação não é descartada por um match tardio. O servidor serializa
cancelamento/match e fecha a sala associada, sem fechar uma sala de intenção nova.
`leave_room` termina também as intenções da sala; se esta já foi purgada, a saída
é idempotente. Uma referência a sala existente de terceiro continua recusada.

O hook classifica falhas por código SQL/PostgREST e status HTTP, sem inferir
encerramento a partir do texto. Recusas de acesso suspendem o polling automático;
falhas transitórias/desconhecidas permitem confirmação manual e polling de retry.
Sem estado confirmado recente não há envio nem prolongamento. Prazos e votos
continuam a vir do servidor; novos pares exigem hora servidor recente antes de
22:48, verificada também após a saída para a conversa seguinte.

`chatStore.contextVersion` invalida respostas imediatamente ao mudar sala,
proprietário, intenção de fila ou ao fazer reset, mesmo se os IDs forem depois
reutilizados. A instância do chat é também remontada nessas transições. Respostas
de RPCs/Functions e broadcasts antigos não aplicam estado, mensagens ou navegação
a um contexto novo. Este contador local não concede autorização.

### Mensagem

`Chat` subscreve `room:<uuid>` privado e chama `send-message` por HTTP. A Function
verifica Auth/membership, obtém lock, acrescenta ao Redis com deduplicação Lua e
publica o broadcast privado pelo servidor. O browser adiciona o resultado
confirmado e deduplica a receção por `(sender_id, id)`. Num retry do mesmo conteúdo
mantém o ID; um UUID igual usado pelo outro participante identifica outra mensagem.

Após cada transição para `SUBSCRIBED`, `useChatHistory` pede `get-room-messages`.
A receção já está instalada antes da leitura: broadcasts recebidos durante o
pedido são fundidos com o snapshot no estado atual, preservando chaves conhecidas
e ordenando por timestamp/remetente/ID. Cancelamento de subscrição, mudança de identidade,
sala ou `contextVersion` invalidam respostas pendentes. Não há polling adicional;
um erro permite retry manual e mantém as mensagens conhecidas e a saída/denúncia.

A nova Function valida JWT e autorização de sala ativa, usa o lock comum e uma
leitura Lua limitada/fenced, e volta a autorizar antes da resposta. Não escreve
no buffer/deduplicação nem prolonga retenção. O resultado é sempre parcial:
mensagens cujo TTL expirou não podem ser reconstruídas. A interface apresenta
essa limitação, incluindo quando a lista devolvida está vazia. Ver
[validação U04](validation/2026-10-05-chat-history.md).

### Denúncia

`Chat` chama `report-room` apenas com o ID da sala. A Function usa o mesmo lock,
congela a sala via autorização, lê o buffer e chama `persist_room_report`.
O transcript vem do servidor, não de uma lista que o browser possa falsificar.
Falha de persistência devolve erro e permite retry; o buffer não é apagado nessa
operação. O TTL pode expirar, pelo que não há garantia de histórico completo.

Falha de `report-room` é apresentada como «Denúncia não confirmada». O browser
não infere suspensão a partir de 401/403, lock 409, falha de serviço ou erro de
ligação. Mantém a mesma sala para retry; apenas `success: true` confirma a denúncia
e permite limpar contexto/navegar. Os pedidos cliente de RPCs e Functions têm
timeout de 10 segundos; sair localmente continua disponível com pedido pendente.

## Apresentação, teclado e retenção — U05

Os modais são montados por portal no `body`, com `role="dialog"`,
`aria-modal`, título e descrição curta associados. O hook mantém apenas o modal
superior interativo, aplica `inert` ao fundo (incluindo novos elementos), contém
Tab/Shift+Tab e repõe o foco anterior se o elemento ainda estiver disponível.
Preserva os valores `inert` anteriores e suporta montagem dupla em StrictMode.
Os termos começam no título; a confirmação de eliminação começa em Cancelar.
Escape fecha as Definições, mas não fecha nem aceita os termos obrigatórios.
O conteúdo comprido tem scroll; o cabeçalho das Definições permanece visível.

Botões com ícones e campos têm nomes acessíveis; erros dos modais são alertas.
Os relógios não são regiões de anúncios automáticos. O documento identifica
`pt-PT`, título Aquecimento e um favicon SVG próprio. Login, termos e eliminação
explicam o buffer parcial e a limpeza periódica, sem prometer registo integral
ou apagar todos os vestígios ao fim de exatamente 30 dias. Ver
[validação U05](validation/2026-10-05-interface-fixes.md).

## Limites de confiança

Interface e `sessionStorage` são estado de apresentação e podem estar desatualizados.
Auth valida identidade; RPCs validam elegibilidade, membership e prazos;
Functions controlam efeitos no Redis e Realtime. Segredos só existem no servidor.
Ver [contratos](contracts.md) para interfaces e [validação](validation/README.md)
para o que ainda precisa de ser provado em sessões reais.
