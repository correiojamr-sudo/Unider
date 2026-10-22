# Nome de apresentação — 10/10/2026

Base: `7695f61`, branch existente `fix/unider-functional-recovery`. Preservados
os documentos locais da sincronização Supabase anterior, sem commit/push/deploy.

## Implementação

- Registo pede «Nome de apresentação» e informa visibilidade ao interlocutor;
  pode ser nome de uso. Email, nascimento e género continuam fora do chat.
- Termos/privacidade 2.1 explicam destinatário, ausência de diretório público,
  nome não verificado e possibilidade de cópia pelo destinatário.
- Nova migration gerada pelo CLI, sem modificar SQL aplicado: trigger e
  elegibilidade/aceitação passam a 2.1; sem backfill de consentimento ou dados.
- `room_json`, privado e sem EXECUTE cliente, fornece apenas `peer_name` a um
  participante da sala quando ambos são elegíveis com termos 2.1. Não concede
  SELECT do registo do interlocutor nem altera permissões de denúncias/Realtime.
- React mostra nome no cabeçalho e mensagens do colega como texto, não HTML.
  Campo ausente/null usa «Colega». Nome permanece no estado RPC, não é acrescentado
  ao store persistido, JWTs, payloads de mensagem ou buffer Redis.

Ficheiros: migration `20261010183634_peer_display_name_terms_v21.sql`,
`src/lib/legal.ts`, `src/lib/chatSession.ts`, `src/pages/Login.tsx`,
`src/pages/Chat.tsx`, testes de base/estado/browser/termos e fixtures 2.1;
arquitetura, contratos, operação e estado atualizados.

## Verificação e limites

`npm test` com cinco fixtures Chrome isoladas: 110 aprovados, zero falhas,
dois excluídos por concorrência PGlite. Lint passou sem avisos; build sintético
não publicável passou. Incluem interlocutor autorizado, terceiro recusado,
registo privado inacessível ao outro, metadata editável ignorada, ausência de
nome, termos 2.0 recusados e nomes não fornecidos antes da aceitação 2.1.
Browser comprova texto literal para nome contendo HTML, fallback e remoção do
nome anterior ao mudar o contexto. Não altera Functions; type-check Deno não
foi repetido nesta tarefa. Concorrência PostgreSQL fica dependente do CI futuro.

Nenhuma alteração remota nesta tarefa. Supabase continua no estado 2.0 do
[registo anterior](2026-10-10-supabase-sync.md); este candidato requer autorização
de publicação coordenada antes de ser observado no site. Não se certifica
conformidade jurídica nem funcionamento alojado por testes isolados.
