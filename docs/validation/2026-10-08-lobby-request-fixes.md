# Recuperação dos pedidos do lobby — A05

## Objetivo e versão de partida

Correção local de A05 sobre `5fcd34b4eaa6b5cd4fa8681817128a4c6bdfb33f`, na
branch `fix/unider-functional-recovery`, preservando o candidato A01–A04 já
revisto pela Coordenação. Esta entrega não altera schema ou APIs servidor.

## Comportamento

- A leitura dos termos e o INSERT de sugestões recebem um sinal composto pelo
  controller da operação e pelo timeout de 10 segundos (`AUTH_TIMEOUT_MS`).
  O helper `lobbyRequest` limita também a espera da interface e consome respostas
  tardias, incluindo rejeições de um transporte que não respeite o sinal.
- Timeout/erro nos termos bloqueia entrada e oferece «Verificar termos».
  Retry substitui a leitura anterior; consentimento depende da revisão Auth atual.
- Timeout/erro no envio liberta edição e botão, conserva o texto e não repete
  automaticamente o INSERT. A mensagem pública indica que a sugestão pode já
  ter sido recebida. Abort não garante rollback nem ausência de persistência;
  um envio explícito posterior pode duplicar uma sugestão recebida anteriormente.
- Desmontagem, identidade, revisão Auth e substituição de pedido invalidam
  callbacks e cancelam o transporte. Renovar sessão do mesmo ID conserva o
  rascunho, liberta envio pendente e volta a consultar os termos. Mudança de ID
  monta o formulário novo, preservando isolamento entre utilizadores.
- Mantêm-se INSERT apenas de `user_id`/`suggestion`, cancelamento da fila com
  UUID/dia, suspensão de entrada automática e conservação da sala existente.

## Ficheiros desta alteração

`src/pages/Lobby.tsx`, novo `src/lib/lobbyRequest.ts`, `tests/lobby.test.cjs`,
`tests/lobby-browser.test.cjs`, documentação de arquitetura/contratos e este
registo. Em `tests/chat-browser.test.cjs`, apenas o mock da leitura de perfil
recebe a interface `abortSignal` do SDK; as regressões A02/A03 ficam preservadas.
O mesmo método é acrescentado ao mock de query de
`tests/accessibility-browser.test.cjs`, sem alterar as asserções ou timeouts.

## Verificação local

- `node --test --test-isolation=none tests/lobby.test.cjs`: 10 passaram, zero
  falhas/excluídos. O SDK Supabase instalado executa GET/POST contra transporte
  local pendente: ambos recebem e abortam o sinal após cerca de 10 segundos
  reais, e apenas um INSERT é emitido. Não há HTTP externo. Outro cenário
  confirma cancelamento com transporte que ignora abort e resposta/rejeição tardia.
- Fixture Chrome do lobby em 390×844, React StrictMode e stores reais: os sete
  testes passaram. Inclui dois períodos reais superiores a 10 segundos, retry,
  rascunho preservado, INSERT sem retry automático, renovação do mesmo ID com
  sucesso/rejeição antiga e desmontagem. Os pedidos externos são bloqueados.
- `node --test --test-isolation=none tests/lobby-browser.test.cjs tests/chat-browser.test.cjs`:
  22 passaram, zero falhas/excluídos; confirma também o fixture de chat e as
  regressões existentes após o ajuste estreito do mock de leitura de perfil.
- `node --test --test-isolation=none tests/accessibility-browser.test.cjs`:
  um passou, zero falhas/excluídos; teclado, isolamento de modais, consentimento
  obrigatório e layout 320×568 no Chrome, sem pedidos externos.
- `node node_modules/typescript/bin/tsc -b --pretty false` passou;
  `node node_modules/oxlint/bin/oxlint` passou sem avisos.
- `git diff --check` passou. Os gates completos, build e Deno do candidato
  integrado ficam a cargo da Coordenação antes da aceitação.

## Limites e operação

Os testes usam transporte/stores simulados no browser e SDK com fetch injetado;
não comprovam PostgREST/Auth alojados, entrega real ou persistência após abort.
O limite de `AbortSignal.timeout` mede tempo ativo do browser; um separador
suspenso pode recuperar apenas ao retomar. Não há contrato novo de idempotência
para sugestões nem retry automático. Nenhum deploy, migration aplicada, dado,
conta/email, configuração remota, commit, push ou PR foi alterado nesta entrega.
O diff permanece local para revisão e aceitação da Coordenação.

A [referência atual de abortSignal](https://supabase.com/docs/reference/javascript/using-modifiers-abortsignal)
e o código/tipos do SDK instalado foram consultados; o modificador precede
`single()` para preservar a interface TypeScript.
