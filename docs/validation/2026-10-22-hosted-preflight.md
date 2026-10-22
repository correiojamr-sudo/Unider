# Preparação da tentativa alojada A/B/C — 22/10/2026

## Estado: revisto e preparado para uma tentativa

O procedimento foi concluído, revisto pela Coordenação e validado localmente.
**Não equivale a testes alojados aprovados. Nenhuma conta foi criada ainda.**
Base `b7a62bc1107d48224d7d34def130e90d96edb479`, branch partilhada
`fix/unider-functional-recovery`; alterações locais anteriores preservadas.
Não houve commit, push, migration, deploy ou alteração das configurações remotas.
A correção local de arranque Auth descrita no
[registo anterior](2026-10-22-entry-readiness.md) também continua sem publicação.

## Autoridade e agendamento

O proprietário autorizou criar no máximo três contas exclusivamente de teste no
Unider Development (`ymzcsoyylrpkdflnlvkg`), com dados fictícios, confirmação
administrativa sem emails e eliminação após os testes. Autorizou depois uma única
tentativa em **22/10/2026 às 22:30 Europe/Lisbon** (21:30 UTC).

Agendamento nativo: `aquecimento-teste-privado-a-b-c`, heartbeat desta thread,
ACTIVE e limitado a uma ocorrência. O fuso do computador foi confirmado como
Lisboa. Exige computador ligado e aplicação aberta; não é um serviço remoto
independente. Se arrancar atrasado, fora da data/janela, ou sem pré-requisitos,
parar e informar, sem reagendar ou criar outras contas automaticamente.

Não abrir/fechar inscrições, alterar horários, políticas, schema, Functions,
segredos na plataforma ou contas existentes. Não enviar emails, criar denúncias,
simular falhas de infraestrutura ou publicar código nesta tentativa.

## Credenciais e verificações já feitas

`.env.hosted-test.local` é local, ignorado e não acompanhado pelo Git. O
proprietário preencheu a chave administrativa diretamente no ficheiro; nunca
imprimir/copiar o seu conteúdo em ferramentas de texto, logs ou mensagens.
Não usar `VITE_*`, nem incorporar esta chave num browser ou build.

O cliente administrativo serve apenas o preflight/criação/limpeza. Clientes A/B/C
usam chave publishable e login/password reais. A chave administrativa foi
validada com consulta de um UUID aleatório inexistente: HTTP 404/user_not_found,
sem ler contas existentes ou criar utilizadores. O formulário do painel não
aceita os metadados obrigatórios do trigger; não desligar o trigger para o usar.

Leituras remotas às 14:07 Lisboa: duas contas, zero salas abertas/fila. Auth
respondeu 200, email ligado, `disable_signup: false`, `mailer_autoconfirm: false`.
As inscrições já estavam ativas na leitura; não foram ativadas nesta operação.
Isto não verifica SMTP ou entrega de confirmação/recuperação por email.

## Procedimento e versões revistas

Antes de executar, confirmar pasta, branch, estado e os hashes abaixo. Se o
procedimento tiver mudado, não executar sem nova revisão.

| Ficheiro | SHA-256 revisto |
| --- | --- |
| `scripts/hosted/private-chat-check.mjs` | `797E110FB34BC50C22E91595347D6A619FA0870DF185A08FBA622FA03600FA10` |
| `tests/hosted-plan.test.mjs` | `24323C1C641E140CB72AD1679CC4691FB18F92D720A795CD56E1DC5327AF8E47` |

O modo sem argumento/`--plan` não lê credenciais, cria clientes ou inicia rede.
O modo `--execute` exige alvo exato, HTTP Date do servidor em 22/10/2026 entre
22:30 inclusive e 22:43 exclusive e preflight conservador: sem salas/fila ou
perfis reais com termos 2.1 aceites. Não alterar esses dados para passar o teste.
Se o preflight abortar, isso é paragem de segurança, não defeito demonstrado da app.

Após o preflight é criada uma marca atómica em
`node_modules/.cache/hosted-private-chat/ymzcsoyylrpkdflnlvkg-2026-10-22.attempt.json`.
Não a remover para repetir. Uma execução interrompida pode ter deixado contas;
reconciliar a execução anterior antes de qualquer nova autoridade/criação.

Comando em PowerShell, na raiz, apenas na janela/data autorizadas:

```powershell
& 'C:/Users/joaoa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' --env-file=.env.hosted-test.local scripts/hosted/private-chat-check.mjs --execute
```

O carregamento do ficheiro ocorre apenas no processo Node. Nenhum segredo consta
do comando, relatório ou fonte. Não apontar `tests/database.test.mjs` nem o harness
local ao Supabase; este procedimento manual é separado.

## Cenários e critérios

1. Criar até três contas com emails UUID sintéticos, nome de teste, nascimento
   fictício adulto, género undisclosed, aceitação sintética 2.1 e marcador da
   execução, por AuthAdmin `createUser` com confirmação administrativa. Sem SQL
   direto em `auth.users`. Passwords aleatórias existem só em memória.
2. Entrar por password com três clientes comuns; A/B usam o emparelhamento real
   e C fica fora da fila. Se algum peer não for o outro fixture, não enviar mensagens.
3. A/B subscrevem `room:<uuid>` privado; C tem de receber recusa explícita.
   Timeout/erro de transporte é inconclusivo, não prova de autorização correta.
4. Envio pela Function chega a A/B; retry conserva ID e o histórico da Function
   contém uma entrada. Demonstra o caminho Functions/Redis nesse cenário, não
   todos os TTLs, condições concorrentes ou modos de falha.
5. Broadcast WS de membro tem de ser observado como frame WS, não fallback REST.
   REST de membro, C e anónimo não chega a A/B, com controlos positivos servidor
   antes/depois e observação limitada explícita; HTTP 202 isolado não decide.
   WS do terceiro/anónimo não está implementado e não pode ser marcado aprovado.
6. `finally` remove canais, revalida cada ID/email/marcador, revoga sessões
   conhecidas, apaga apenas contas próprias e confirma ausência. Nunca eliminar
   por domínio ou prefixo. Criação ambígua tem procura limitada pelo marcador;
   o relatório sinaliza alvos pendentes de reconciliação manual.

Os relatórios ficam em `node_modules/.cache/hosted-private-chat/<run-id>.json`,
sem passwords, tokens ou conteúdos. Mensagens sintéticas podem permanecer no
buffer até expirar segundo o TTL normal; não apagar chaves Redis indiscriminadamente.
Depois de confirmar a limpeza e não haver reconciliação pendente, remover apenas
o ficheiro local `.env.hosted-test.local`; não revogar/alterar a chave da plataforma.
Não dar o teste por concluído se a limpeza ficar por confirmar.

## Verificação desta preparação

- Dez testes offline do procedimento: todos passaram, zero rede real. Incluem
  alvo/data/horário, replay, limite três, separação dos clientes, cleanup em falha,
  criação ambígua, recusa inconclusiva e deteção de entrega indevida/controlo ausente.
- Revisão da Coordenação acrescentou o bloqueio atómico de replay e retirou a
  limpeza recursiva do diretório temporário do teste local.
- Suite serial completa, cinco fixtures Chrome: **125 aprovados, zero falhas ou
  cancelamentos, dois excluídos por concorrência PGlite**, em 83,7 s. Lint sem
  avisos e TypeScript/build passaram, usando os equivalentes Node dos scripts
  porque `npm` não está no PATH. Build sintético não publicável.
- Teste real do fencing fora do horário: resultado `outside_authorised_window`,
  fixtures vazios, nenhuma limpeza necessária e nenhuma marca de tentativa
  consumida. Relatório local `a4b24aea-9e00-486f-b084-a0d6e1715def.json`.

Não foram executados nesta preparação canais privados autenticados A/B/C, envios
reais, Redis, SMTP, denúncias, bans, retenção, falhas concorrentes ou dois browsers
reais. Functions e Deno não mudaram. As verificações acima não aprovam lançamento.

Referências do contrato utilizado: [AuthAdmin createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser),
[Realtime Broadcast](https://supabase.com/docs/guides/realtime/broadcast).
