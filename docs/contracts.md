# Contratos atuais entre interface e servidor

Fonte principal: `supabase/migrations/20261002231850_secure_chat_lifecycle.sql`,
`src/lib/chatSession.ts` e handlers em `supabase/functions/`. Este documento
descreve o código; não comprova o estado de uma instalação alojada.

## Entrada e sessão no cliente

A versão legal preparada é 2.0; a migration incremental
`20261010145007_adult_terms_v2.sql` ainda não foi aplicada ao serviço alojado.
`eligible` exige versão atual, data de aceitação e declaração de maioridade,
além de conta não banida. O RPC antigo de um argumento deixa de estar concedido
ao cliente. A declaração não comprova idade. Termos/privacidade são rotas públicas.

O ecrã inicial separa «Entrar» (por defeito) de «Criar conta». Login chama
`signInWithPassword({email,password})`, nunca cria conta nem faz fallback para
registo. O email é normalizado com trim/minúsculas; a password nunca é alterada,
guardada em perfil, logs ou armazenamento próprio. Uma sessão Auth válida continua
a evitar repetir login. Guardas/armazenamento scoped são preservados.

Registo chama `signUp` com email/password e metadados iniciais: nome de uso,
data de nascimento ISO, género male/female/undisclosed, versão 2.0 e declaração
explícita. UI exige password 12–128 caracteres e aceitação; os limites reais da
password também devem ser configurados em Auth, não são impostos por SQL.
Links públicos permitem leitura; checkbox não prova leitura efetiva.

A migration incremental `20261010170027_private_registration_details.sql`
valida os novos registos no trigger: domínio, nome, data real, idade >=18 pela
data Lisboa, enum género, versão e declaração. Grava os dados em
`account_details` (SELECT só do próprio, sem escrita cliente), ligado ao perfil
com DELETE CASCADE; regista aceitação no perfil protegido. Os metadados iniciais
também existem em Auth e podem constar da sessão/JWT do próprio. Alterar esses
metadados posteriormente não altera dados privados/consentimento/ban, nem concede
acesso. Nunca decidir autorização por user_metadata/JWT editável.
Os dados não são incluídos nos contratos do chat ou no emparelhamento.

Contas antigas não recebem nome, nascimento ou género inventados; continuam a
precisar dos termos atuais e declaração. Quem só usava OTP pode definir uma
password pela recuperação. `eligible` exige também email confirmado no servidor
e endereço institucional atual. Não desativar confirmação de email para facilitar
o fluxo. Autenticação não prova idade real.

Registo sem sessão mostra aviso condicional de confirmação, não afirma criação
nem revela se o endereço já existia. `emailRedirectTo` aponta para /login.
Reenvio explícito usa `resend({type:'signup',email})`, sem criar conta, com
60 segundos de espera local incluindo erros. Limites alojados continuam
autoritativos. Recuperação /recuperar-password não usa AuthRoute:
antes da sessão chama `resetPasswordForEmail` com resposta não enumeradora e
redirect para a mesma rota; depois da ligação validada por Auth, `updateUser`
altera a password da sessão. Mudança de identidade remonta o formulário,
apagando password/avisos; operações antigas não confirmam sucesso. Password
alterada não afirma revogação de todas as outras sessões.

Site URL, redirects exatos, templates ConfirmationURL de signup/recovery,
SMTP, política de password e limites têm de ser validados no ambiente autorizado.
Nada desta mudança local configura serviços, abre inscrições ou envia emails.
Documentação oficial: [passwords](https://supabase.com/docs/guides/auth/passwords),
[signUp](https://supabase.com/docs/reference/javascript/auth-signup).

Auth e RPCs de login/termos/definições/saída usam timeout de 10 segundos.
Cancelamento ou timeout não desfaz uma ação já recebida pelo servidor; o cliente
apenas deixa de aplicar uma resposta antiga. `accept_terms` exige `data === true`;
eliminação e saída RPC void exigem ausência de erro. Após eliminação confirmada
não se volta a pedir eliminação para repetir logout.

A consulta `profiles.terms_version` e o INSERT de `icebreaker_suggestions`
também usam `AUTH_TIMEOUT_MS` (10 segundos), com o sinal encaminhado por
`abortSignal` ao SDK. A espera da interface termina nesse prazo mesmo perante
transporte tardio; a leitura oferece retry e a sugestão mantém o texto. Não há
retry automático do POST e a interface indica que uma escrita pode já ter sido
recebida. Um novo envio explícito pode criar outra sugestão: este contrato não
introduz deduplicação servidor. Identidade, montagem, pedido e `sessionRevision`
invalidam respostas antigas; renovar a sessão do mesmo utilizador volta a
verificar os termos e conserva o rascunho. Ver [validação A05](validation/2026-10-08-lobby-request-fixes.md).

Logout só limpa sessão/chat após confirmação Auth atual. O armazenamento temporário
do SDK descarta alterações em erro, inclusive a remoção local que o SDK pode
preparar num logout offline. Uma falha de `leave_room`/`leave_matchmaking` não
prossegue para logout nem confirma fecho. A eliminação continua a depender do
RPC servidor e não concede autoridade a um JWT antigo.

`authStore.contextVersion` e `sessionRevision` são contadores locais, separados
do contador de chat de U02. Servem para descartar respostas, não para autorizar
pedidos. Um aviso entre separadores relê a sessão principal; não transporta JWT,
email, ID de utilizador nem uma notificação `SIGNED_OUT` de origem antiga.

## Interfaces usadas pelo cliente autenticado

| Operação | Entrada | Resultado/função |
| --- | --- | --- |
| `accept_terms` | `p_version: '2.0'`, `p_adult: true` | `true`; guarda versão, data e `adult_declared_at` no servidor. |
| `find_or_join_match` | `p_intent: uuid`, `p_day: date` | `waiting`, `closed`, `cancelled` ou objeto `matched`; intenção da entrada no separador. |
| `get_room_state` | `p_room: uuid` | `RoomState`; valida membership e renova heartbeat. |
| `get-server-time` (Function) | `POST {}` com JWT de utilizador | `{ server_now: ISO UTC canónico }`; apenas apresentação, sem mutações. |
| `extend_room` | `p_room: uuid` | `RoomState`; regista voto e pode prolongar uma vez. |
| `leave_room` | `p_room: uuid` | Termina a sala do participante e as intenções associadas; ausência real é sucesso idempotente, sala existente de terceiro é recusa. |
| `leave_matchmaking` | `p_intent: uuid`, `p_day: date` | Cancela definitivamente essa intenção e a sala que ela encontrou, se existir; não afeta uma intenção posterior. |
| `delete_own_user_account` | Sem argumentos | Elimina a própria conta; fecha salas e preserva prova conforme retenção. |
| `send-message` | `{ roomId, message: { id, text } }` | `{ success: true, message }`; envio só pelo servidor. |
| `get-room-messages` | `{ roomId }` | `{ success: true, roomId, messages, partial: true }`; snapshot do buffer ainda disponível, apenas para sala ativa autorizada. |
| `report-room` | `{ roomId }` | `{ success: true }` após persistência; congela a sala. |

Functions aceitam `POST` e tratam `OPTIONS`. Usam JWT validado e não aceitam
identidade escolhida pelo cliente. `authorize_room(p_room,p_user,p_operation)` e
`persist_room_report(p_room,p_user,p_transcript)` são RPCs exclusivos de
`service_role`, não APIs para o browser.

`RoomState` inclui `room_id`, `peer_id`, `expires_at`, `hard_close_at`,
`decision_until`, `ended_at`, `end_reason`, `extended_once`, `extended`,
`peer_extended` e `server_now`. Mudanças neste formato são transversais: atualizar
SQL, hook, helper, interface e testes na mesma tarefa atribuída.

## Realtime e tabelas

- Tópico de sala: `room:<uuid>`, com `config.private: true` no cliente.
- Evento recebido: `message`; payload `{ id, sender_id, text, timestamp }`.
- Cliente recebe; só o servidor publica. Não criar política cliente de INSERT
  para estes tópicos. As guards restritivas também protegem contra uma política
  permissiva ampla preexistente.
- `profiles`: identidade institucional, ban e consentimento. Sem escrita direta
  cliente para alterar ban ou consentimento.
- `icebreaker_suggestions`: o cliente só tem INSERT de `user_id` e `suggestion`,
  com autoria própria e `is_approved IS FALSE`; só lê aprovadas. Não pode enviar
  `is_approved` (incluindo `false`/`null`), nem aprovar por UPDATE/upsert. Escrita
  administrativa e aprovação pelo serviço mantêm-se. A migration nova remove
  grants de escrita por tabela e por coluna de PUBLIC/anon/authenticated antes
  de conceder os dois campos permitidos.
- `matchmaking_queue`: fila/lease; gerida por RPC, não por INSERT cliente.
- O lobby não cria `campus-queue` nem outro Presence público. A pré-fila é
  intenção local cancelável, não confirmação de uma entrada na fila servidor.
- `active_rooms`: participantes, prazos, votos, heartbeats e encerramento.
- `reported_chats`: prova persistida pelo servidor; não por INSERT cliente.

Uma resposta REST 202, isoladamente, não prova entrega nem recusa de broadcast.
Nos testes observar a não entrega aos participantes e incluir envio positivo
do servidor. Ver [evidência histórica](validation/2026-10-03-hosted-services.md).

## Prazos e limites implementados

U06 acrescenta `get-server-time` com o padrão comum POST/OPTIONS e JWT ligado;
`authenticate` chama `auth.getUser` e recusa identidade inválida. Resposta com
`Cache-Control: no-store`; não lê/muta fila/sala/Redis nem publica mensagens.
Não confundir esta hora da Function com a hora PostgreSQL dos prazos da sala.
O cliente usa uma estimativa limitada por RTT de 5 segundos e frescura de 90
segundos, no contexto da revisão Auth atual. Falhas/respostas antigas não
substituem o contexto nem descartam uma sala. Gate e `queueDay` no lobby usam
essa estimativa; amostra ausente/stale bloqueia novas entradas, preservando
cancelamento e regresso à conversa. Novo Chat usa a data do estado PostgreSQL.
Os RPCs continuam a decidir os horários, elegibilidade e membership no servidor.

| Regra | Valor/fonte |
| --- | --- |
| Pré-fila local no lobby | 22:28 inclusivo até antes de 22:30, `lobbySchedule.ts`. |
| Entrada para novos pares no lobby | 22:30 inclusivo até antes de 22:48; 22:48–22:50 apresenta o fecho, sem nova entrada. |
| Novos pares no servidor | 22:30 inclusivo até antes de 22:48, Lisboa. |
| Fecho absoluto | 22:50, Lisboa. |
| Conversa inicial | 2 minutos, limitada pelo fecho absoluto. |
| Decisão de prolongamento | Até 30 segundos após o prazo inicial, limitada pelo fecho. |
| Prolongamento | Uma vez, ambos votam, até mais 3 minutos; nunca após 22:50. |
| Lease de fila / heartbeat de sala | 15 segundos / encerramento se heartbeat atrasado mais de 45 segundos. |
| Polling / estado considerado fresco na UI | 3 segundos / menos de 10 segundos desde confirmação. |
| Mensagem / quota por sala | Até 2.000 caracteres / 200 IDs no hash de deduplicação. |
| Lock Redis | `SET NX EX 60`; release apenas com o token proprietário. |
| Buffer / metadados Redis | 300 / 600 segundos desde append novo aceite. |
| Janela de denúncia | 5 minutos após o fim efetivo: o primeiro entre encerramento registado, prazo da sala (incluindo decisão inicial), heartbeat + 45 s e fecho absoluto. |
| Retenção SQL | Denúncias elegíveis após 30 dias; salas após `hard_close_at` + 1 dia. |
| Limpeza agendada no schema | A cada 5 minutos; falhas podem exceder a retenção operacional. |

Chaves Redis: `room:<uuid>:lock`, `room:<uuid>:messages`, `room:<uuid>:dedup`.

B01 acrescenta `unider_private.room_end_limit` na migration
`20261008181527_deterministic_room_end.sql`. O encerramento automático guarda o
limite efetivo já ultrapassado, em vez da hora de uma consulta tardia. A denúncia
usa esse limite mesmo para salas encerradas pelo helper anterior; não reescreve
histórico nem prova persistida. Encerramentos explícitos anteriores aos limites
mantêm a sua hora. O prazo inicial inclui a decisão de 30 segundos, a extensão
não tem nova decisão e o heartbeat termina após 45 segundos. A fronteira da
denúncia mantém a comparação existente: aceita até ao limite + 5 minutos
inclusivo, recusa depois. Uma recusa que faça rollback do refresh não altera
esse cálculo num retry. Ver [correção B01](validation/2026-10-08-followup-review.md#correção-b01--validação-local).

Retry com a mesma chave `(sender_id, id)` já aceite não renova os TTLs. Essa chave
composta identifica também snapshots, fusão cliente e elementos React: dois
participantes podem usar o mesmo UUID e ambas as mensagens são apresentadas.
Conteúdos contraditórios para o mesmo remetente/UUID recusam o snapshot inteiro.
`dedup` conserva IDs, timestamps,
remetente e hash do texto, não o plaintext. A quota depende da existência desse
hash, não de um contador permanente.

O browser pode conservar mensagens no `sessionStorage` enquanto o separador
existe. `chatStore` limpa contexto em mudança de proprietário/sala ou reset.
Não confundir TTL Redis com um prazo universal de apagamento no browser.

### Comunicação na interface — U05

Login e termos indicam que a denúncia guarda o conteúdo então disponível;
não garantem a conversa completa. O buffer expira 5 minutos após append novo
aceite; repetir um ID já aceite não prolonga a retenção. Retry/cancelamento
não recuperam conteúdo expirado. A limpeza periódica elimina denúncias com
mais de 30 dias, sem garantir uma hora exata de eliminação. A confirmação de
apagamento da conta mantém essa distinção e os prazos separados de participação,
buffer e metadados. Finalidades e versão de consentimento `1.1` mantêm-se.

A semântica/foco dos modais é apresentação: Escape não aceita nem dispensa
termos obrigatórios e a confirmação continua a exigir resposta servidor `true`.
Estas alterações não modificam JWT, RPCs, autorização, retenção ou políticas.
Ver [validação U05](validation/2026-10-05-interface-fixes.md).

### Recuperação do buffer

`get-room-messages` valida o UUID da sala e obtém a identidade de `auth.getUser`
com o JWT recebido. Usa o mesmo lock dos envios/denúncias e `authorize_room` com
operação `message`, antes da leitura e antes de devolver o resultado. Membership,
ban, consentimento e prazo são verificados no servidor. Não usa a operação
`report`, não congela a sala e não publica broadcasts.

Um script Lua verifica o token do lock e lê atomicamente `LRANGE 0 199`; recusa
um buffer com mais de 200 entradas. Só executa `GET`, `LLEN` e `LRANGE`. Criar e
libertar o lock não altera mensagens, deduplicação ou os seus TTLs. Cada entrada
deve ter UUID válido, remetente participante, texto não vazio até 2.000 caracteres
e timestamp ISO UTC canónico. Dados inválidos ou IDs com conteúdos contraditórios
recusam o snapshot inteiro (503); lock perdido/ocupado devolve 409.

`partial: true` é obrigatório mesmo para uma lista vazia: um buffer expirado não
prova ausência de mensagens anteriores. Não há histórico recuperável garantido
após fecho/decisão, expiração do buffer ou revogação de acesso. O cliente pede
uma vez após cada transição para `SUBSCRIBED`, já com receção instalada; não faz
polling de histórico. Snapshot, broadcasts e respostas de envio são fundidos
atomicamente por `(sender_id, id)`, preservando mensagens conhecidas, por timestamp
e depois pela chave composta.
Erro conserva mensagens e oferece retry manual; respostas de contexto antigo
(incluindo `contextVersion`) ou de uma subscrição interrompida são ignoradas.
Recuperação pendente não bloqueia saída ou denúncia.

`isQueueing`, `queueDay` e `queueIntent: { id, day }` conservam a intenção de espera no separador para o
mesmo `ownerId` e dia de Lisboa. A entrada automática pelo lobby exige essa
intenção, ausência de sala, fase de novos pares e termos `1.1` confirmados para
o utilizador atual. Cancelamento confirmado remove a intenção; contexto antigo sem UUID/data ou
do dia anterior não ativa entrada. Limpar a intenção não limpa uma sala existente.
Estes campos não concedem membership nem autorização: o RPC continua a validar
consentimento, elegibilidade e os prazos com hora do servidor.

`queueIntent.id` nasce num novo clique de entrada; refresh conserva-o e uma sala
encontrada mantém a associação para a saída. `queueCancelling` suspende a entrada
automática/polling antes do pedido, incluindo respostas já pendentes, mas não muda
`contextVersion`: a própria confirmação de saída continua válida. Falha conserva
essa intenção suspensa para retry, também após refresh; saída local explícita
continua sem confirmar o efeito remoto.

Os dois RPCs de fila exigem UUID e dia de Lisboa. A tabela privada
`unider_private.matchmaking_intents` liga `(user_id, intent_id, intent_day)` a
cancelamento/sala; nunca recebe escrita cliente direta. Cancelamento cria um
registo mesmo se o primeiro pedido de entrada ainda não chegou. Emparelhamento,
cancelamento e saída de sala usam o mesmo lock transacional; uma intenção que já
encontrou uma sala não cria outra. `leave_room` também termina as intenções
associadas, impedindo entrada tardia após Novo Chat/logout. Um cancelamento antigo
só fecha a sala ligada à intenção antiga. Datas diferentes do dia servidor não
podem criar pares; o Cron elimina estes metadados anteriores ao dia de Lisboa
anterior, depois de essa regra já impedir a sua reutilização. As assinaturas
antigas sem argumentos foram removidas; requer lançamento coordenado.

## Erros e recuperação

A configuração pública é validada por `publicConfig.ts` antes de criar qualquer
cliente e antes do bundle Vite. URL HTTPS sem credenciais/query/path (HTTP apenas
em loopback explícito), chave publishable ou JWT de role `anon`. Ausência, URL
inválido, `sb_secret_*` e JWT `service_role` recusam build; `CI=true` não dispensa
o gate. Decodificar o role não verifica assinatura, existência, validade ou
correspondência com o projeto. Bootstrap dev permite corrigir/reiniciar/recarregar
e mostra um diagnóstico sem valores; não importa App nem inicia Auth em erro.

Handlers distinguem entradas inválidas (400), Auth inválida (401), sala recusada
(403), lock/retry/ID conflitante (409), quota (429) e falha de serviço (503).
A plataforma pode recusar JWT antes do handler. Não derivar autorização apenas
do texto visual ou do estatuto HTTP; testar efeito, entrega e estado persistido.

A recuperação cliente usa códigos/status estruturados. `42501` e recusas Auth
PostgREST, ou HTTP 401/403/404/410, indicam acesso/conta/recurso recusado; não
provam que a sala terminou. Falhas de ligação, timeout, HTTP 408/409/429/5xx
permitem retry. Erro sem código conhecido ou resposta inválida fica como não
confirmado; não é convertido em «sala fechada» por correspondência de texto.
O polling automático para numa recusa e pode ser reiniciado explicitamente;
nas outras falhas mantém retry. Estado de sala só é aplicado quando o ID, os
campos e as datas esperados são válidos, e o contexto ainda é o atual.

Saída normal exige resposta sem erro de `leave_room`/`leave_matchmaking`;
`data: null` é normal para estes RPCs void. Falha mantém contexto para retry.
`leave_room` devolve sucesso se a sala deixou realmente de existir (por exemplo,
após purga), permitindo logout; uma sala existente de terceiro continua a devolver
`42501`. O cliente não converte erros de autorização ou transporte em sucesso.
A saída local explícita faz reset do separador e da fila, sem afirmar que o
servidor fechou a sala. Não executa `leave_room` por outra identidade nem apaga
prova servidor. Pedidos anteriores podem ainda concluir no servidor.

`report-room` só confirma persistência com `success: true`. Uma resposta de erro
ou perda de ligação não identifica com certeza se o servidor congelou a sala;
o cliente conserva `roomId` para retry e apresenta essa incerteza. A API e o
buffer/prova servidor não foram alterados por esta recuperação.

`contextVersion` é um contador local do contexto de chat, sem papel no JWT ou
nos contratos RPC. Respostas de contextos anteriores são ignoradas, incluindo
os casos de reset seguido de reutilização do mesmo roomId. O UUID de envio é
conservado ao repetir o mesmo texto na mesma instância de conversa; uma falha
transitória não o troca. As guards não alteram os prazos, votos ou políticas de sala.
