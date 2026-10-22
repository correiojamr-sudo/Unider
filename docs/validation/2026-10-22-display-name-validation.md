# Continuação do nome de apresentação — 22/10/2026

Base local: `7695f61d197276766a89ec89f1754e093ad3c4b3`, branch
`fix/unider-functional-recovery`. Preservado o candidato 2.1 e os documentos
da sincronização Supabase de 10/10, todos ainda não commitados nesta leitura.

## Problema reproduzido e alteração

O SQL aceita um nome com até 80 pontos de código Unicode (`char_length`).
JavaScript contava unidades UTF-16: 41 caracteres suplementares eram 82 unidades
e eram recusados tanto no registo como no estado da sala. O input também podia
truncar um nome de 80 caracteres suplementares a metade. Não foi acrescentado
fluxo especial para contas antigas.

- `src/lib/registration.ts`: conta pontos de código, mantendo o limite 80.
- `src/lib/chatSession.ts`: reutiliza essa validação, conservando a exigência de
  não haver espaços externos no nome fornecido pelo servidor.
- `src/pages/Login.tsx`: teto HTML de 160 unidades UTF-16; o submit valida os 80
  pontos de código. Aviso de visibilidade/limite associado ao input por ARIA.
- Testes de registo, estado, browser Auth/chat e SQL exercitam o limite Unicode;
  contratos corrigem também referências desatualizadas a termos 1.1/2.0.

Sem alteração de schema, migration, Functions ou dependências nesta continuação.
Mantêm-se os controlos de membership, versão de termos, identidade e privacidade
do [candidato anterior](2026-10-10-display-names.md).

## Verificação

Testes focados: 26 aprovados, zero falhas e dois excluídos por concorrência PGlite.
Incluem aceitação SQL de 80 caracteres suplementares e recusa de 81.
Lint passou sem avisos; TypeScript/Vite passaram com configuração sintética não
publicável. `git diff --check` sem erros, apenas avisos de normalização CRLF.

A primeira execução completa com browsers falhou: cinco suites excederam os
timeouts, um teste de transporte com prazo 10 s terminou aos 350 s e houve
subtestes cancelados. Não foram alargados timeouts nem removidas asserções.
Isto não prova a causa; a repetição serial foi iniciada para obter evidência
isolando concorrência entre suites.

Repetição serial completa: `node --test --test-concurrency=1 tests/*.test.cjs
tests/*.test.mjs`, com os cinco browsers Chrome isolados: **112 aprovados, zero
falhas/cancelamentos, dois excluídos**, em 121 s. Cenários Unicode de submissão,
estado de sala e layout a 320 px passaram. O mesmo teste real de timeout terminou
aos 10 s nessa repetição; a causa da pausa anterior não foi demonstrada.
Os testes bloqueiam
pedidos externos e usam base isolada; não provam SMTP, Auth/JWT, Redis, Realtime
ou concorrência PostgreSQL alojados. Nenhum harness foi apontado a Supabase.

## Limites operacionais

Sem deploy, SQL/configuração remota ou contas reais criadas/alteradas nesta
continuação. O estado remoto de 10/10 é histórico, não uma verificação de 22/10.
Não se afirma que o site já serve o candidato 2.1. Publicação exige autorização
e sequência coordenada da migration pendente e Pages; SMTP e validação real
continuam fora da conclusão dos testes locais.

## Publicação GitHub autorizada

O proprietário autorizou expressamente commit, push e novo PR, sem merge ou
deploy. Base de `main` confirmada por consulta remota em `7695f61`, igual ao HEAD
local antes deste commit. Publicar na branch existente, sem force push e com
`[CF-Pages-Skip]` no commit para evitar preview Pages. O CI do PR é evidência
separada e não é substituído pelo gate serial local; confirmar o resultado no PR.

Referência da semântica de contagem:
[PostgreSQL 17 — funções de texto](https://www.postgresql.org/docs/17/functions-string.html).
