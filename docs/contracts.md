# Contratos atuais entre interface e servidor

Fonte principal: `supabase/migrations/20261002231850_secure_chat_lifecycle.sql`,
`src/lib/chatSession.ts` e handlers em `supabase/functions/`. Este documento
descreve o código; não comprova o estado de uma instalação alojada.

## Interfaces usadas pelo cliente autenticado

| Operação | Entrada | Resultado/função |
| --- | --- | --- |
| `accept_terms` | `p_version: '1.1'` | `true`; guarda consentimento/hora no servidor. |
| `find_or_join_match` | Sem argumentos | `waiting`, `closed` ou objeto `matched`. |
| `get_room_state` | `p_room: uuid` | `RoomState`; valida membership e renova heartbeat. |
| `extend_room` | `p_room: uuid` | `RoomState`; regista voto e pode prolongar uma vez. |
| `leave_room` | `p_room: uuid` | Termina a sala do participante. |
| `leave_matchmaking` | Sem argumentos | Remove o próprio utilizador da fila. |
| `delete_own_user_account` | Sem argumentos | Elimina a própria conta; fecha salas e preserva prova conforme retenção. |
| `send-message` | `{ roomId, message: { id, text } }` | `{ success: true, message }`; envio só pelo servidor. |
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
- `icebreaker_suggestions`: sugestões; o cliente insere a própria e lê aprovadas.
- `matchmaking_queue`: fila/lease; gerida por RPC, não por INSERT cliente.
- `active_rooms`: participantes, prazos, votos, heartbeats e encerramento.
- `reported_chats`: prova persistida pelo servidor; não por INSERT cliente.

Uma resposta REST 202, isoladamente, não prova entrega nem recusa de broadcast.
Nos testes observar a não entrega aos participantes e incluir envio positivo
do servidor. Ver [evidência histórica](validation/2026-10-03-hosted-services.md).

## Prazos e limites implementados

| Regra | Valor/fonte |
| --- | --- |
| Apresentação da fila no lobby | 22:28–22:30, `appStore.ts`. |
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
| Janela de denúncia | 5 minutos após o limite calculado por `authorize_room`. |
| Retenção SQL | Denúncias elegíveis após 30 dias; salas após `hard_close_at` + 1 dia. |
| Limpeza agendada no schema | A cada 5 minutos; falhas podem exceder a retenção operacional. |

Chaves Redis: `room:<uuid>:lock`, `room:<uuid>:messages`, `room:<uuid>:dedup`.
Retry com ID já aceite não renova os TTLs. `dedup` conserva IDs, timestamps,
remetente e hash do texto, não o plaintext. A quota depende da existência desse
hash, não de um contador permanente.

O browser pode conservar mensagens no `sessionStorage` enquanto o separador
existe. `chatStore` limpa contexto em mudança de proprietário/sala ou reset.
Não confundir TTL Redis com um prazo universal de apagamento no browser.

## Erros e recuperação

Handlers distinguem entradas inválidas (400), Auth inválida (401), sala recusada
(403), lock/retry/ID conflitante (409), quota (429) e falha de serviço (503).
A plataforma pode recusar JWT antes do handler. Não derivar autorização apenas
do texto visual ou do estatuto HTTP; testar efeito, entrega e estado persistido.
