# Verificação da organização do repositório — 2026-10-05

Base GitHub confirmada: `ac042b3ff6e0c4d008fc1a7425049937055702c1`.
Alteração preparada em `chore/project-organization`, sem deploy, SQL remoto,
alteração de segredos/serviços ou criação de contas.

## Preservação e alterações

- Os 53 ficheiros acompanhados da pasta antiga foram comparados com a base
  clonada: zero diferenças de conteúdo, excluindo quebras de linha.
- A pasta antiga, incluindo índice e ficheiros auxiliares, foi preservada.
- Modais movidos de `src/pages/` para `src/components/modals/`; verificação
  integral confirmou apenas alteração de caminhos de importação nos modais.
  `Lobby` apenas atualizou os dois imports.
- Corpo da especificação original preservado; acrescentado aviso histórico e
  mantido um apontador em `specs.md`.
- Sem alterações em migrations, Functions, workflow ou lockfiles/dependências.
- Documentação nova: arquitetura, contratos, desenvolvimento, operação,
  validação, estado, coordenação, instruções e mensagens das áreas.

## Gates executados

| Gate | Resultado |
| --- | --- |
| `npm ci` | Passou, usando o lockfile existente. |
| `npm test` | 24 passaram, zero falhas, um skipped: concorrência PostgreSQL não executada por PGlite. |
| Links relativos dos guias | Passaram; novo teste em `tests/documentation.test.cjs`. |
| `npm run lint` | Passou, quatro avisos `react(set-state-in-effect)` em linhas não alteradas de Chat, Lobby e useChatSession. |
| `npm run build` | Passou; aviso de chunk maior que 500 kB. Não publicado. |
| `deno check` das duas Functions | Passou. |
| Comparação dos modais/especificação | Passou, sem alteração escondida de comportamento/conteúdo histórico. |

A primeira tentativa dos testes foi impedida pela restrição local a subprocessos
(`EPERM`), antes de executar os casos. A repetição autorizada executou os testes
acima; não se alterou o harness para contornar regras de segurança da aplicação.

## Limites

Não foi usado PostgreSQL concorrente local nem repetida a validação alojada.
O CI do PR deve confirmar os gates no ambiente PostgreSQL 17. Os resultados
históricos de 2026-10-03 ficam identificados como tal, e as caixas da validação
ponta a ponta permanecem por concluir.

Não foi habilitado um quadro de coordenação com IDs inventados nem criado qualquer
chat de área. As instruções preparam a sequência de um escritor de cada vez;
o proprietário ainda precisa de associar o projeto local à pasta principal correta.
