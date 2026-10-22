# Arranque Auth e preparação de validação — 22/10/2026

## Âmbito e base

Continuação autorizada pelo proprietário, com revisão delegada e um único
escritor. Pasta principal e branch `fix/unider-functional-recovery` preservadas;
base `b7a62bc1107d48224d7d34def130e90d96edb479`. Preservados os documentos locais
da [publicação anterior](2026-10-22-release.md), ainda sem commit.
Sem nova configuração, migration, deploy, conta, email ou consentimento remoto.

## Defeito reproduzido e correção

No SDK instalado `@supabase/supabase-js` 2.117.2, a renovação de uma sessão
expirada pode falhar com `AuthRetryableFetchError`. As credenciais são conservadas,
mas a notificação inicial é `INITIAL_SESSION` com sessão nula. O observador
aplicava esse evento como logout, apagando a sala persistida e invalidando a
leitura explícita com erro. Resultado anterior: sala removida e nenhum aviso.

`src/lib/authSession.ts` passa a deixar a leitura explícita confirmar ausência
quando recebe esse evento inicial vazio. Erro de leitura termina loading,
preserva contexto e expõe retry; uma leitura sem erro e sem sessão continua a
limpar o contexto. Eventos reais de logout e identidade mais recente conservam
prioridade sobre leituras antigas. Não concede sessão ou permissões a partir
de contexto guardado no browser; autorizações continuam no servidor.

Regressões acrescentadas:

- `tests/auth.test.cjs`: erro devolvido/rejeição após evento inicial vazio,
  recuperação, ausência confirmada, logout real e login novo contra leitura antiga.
- O mesmo ficheiro executa SDK, armazenamento e stores reais, injetando apenas
  o resultado transitório da renovação. Confirma evento inicial vazio, aviso,
  credenciais e sala conservadas, loading terminado e zero pedidos de rede.
  A stack sintética que o próprio SDK escreve no log é esperada neste cenário.
- `tests/auth-browser.test.cjs`: App real em Chrome, erro de arranque após
  `INITIAL_SESSION` nulo, aviso/retry com sala conservada e logout que a limpa.

A revisão independente confirmou a reprodução antes/depois e não identificou
outro defeito concreto nos fluxos delimitados de registo/login/recuperação/termos.
Não equivale a auditoria exaustiva ou prova de email/Auth alojados.

## Documentação e limites das alterações

Atualizados `README.md`, `docs/README.md`, `docs/architecture.md`,
`docs/legal-readiness.md`, `docs/operations/release.md`, `docs/validation/README.md`
e `docs/project-status.md`. Os guias ainda diziam que 2.1 não estava publicada,
descreviam o nome como privado ou pediam OTP no fluxo principal já substituído.
O estado publicado fica separado dos planos históricos, evitando reaplicar
migrations já registadas. Sem alteração do texto legal ou novas conclusões de
conformidade. Sem novas dependências, lockfiles ou Functions.

## Verificação local

O executável `npm` não está disponível neste runtime. Foram executados os comandos
equivalentes aos scripts existentes, sem instalar ferramentas ou alterar scripts:

```sh
node --test --test-concurrency=1 tests/*.test.cjs tests/*.test.mjs
node node_modules/oxlint/bin/oxlint
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
git diff --check
```

Suite serial: **115 aprovados, zero falhas/cancelamentos e dois excluídos**, em
68,4 s. Cinco fixtures Chrome habilitadas com `UNIDER_TEST_PLAYWRIGHT` e
`UNIDER_TEST_BROWSER`, usando o runtime instalado e pedidos externos bloqueados.
Os dois testes excluídos requerem PostgreSQL concorrente, não PGlite.
Lint sem avisos; TypeScript e Vite passaram. Build usa configuração sintética
`https://unider-build.invalid`/`sb_publishable_unider_ci_fixture_only`: **não publicar
este `dist`**. Deno não repetido porque Functions/imports não mudaram.
O CI do PR #11 pertence à base anterior; não é CI deste novo diff local.

## Observações remotas apenas de leitura

Projeto único consultado: `ymzcsoyylrpkdflnlvkg`.

- Duas contas Auth, dois perfis, um registo de detalhes; zero salas abertas e fila.
- `purge-old-reports` ativo a cada cinco minutos; 288 execuções nas 24 horas
  anteriores, todas com estado succeeded, zero failed. Último sucesso observado:
  22/10/2026 às 11:50:00 UTC.

O estado succeeded comprova execução registada, não remoção correta de todas as
cópias/dados. Não se criaram fixtures antigas para testar retenção, nem se
consultaram conteúdos de mensagens ou dados pessoais das contas.
A leitura pública de configuração Auth pelo shell não foi concluída devido a
resolução DNS indisponível nesse ambiente; não é prova de indisponibilidade do
site. Configuração/entrega SMTP atuais não foram verificadas nesta continuação.

## Próximo limite de autoridade

Solicitada autorização para criar e apagar três contas exclusivamente de teste,
com dados fictícios e confirmação administrativa sem emails. Enquanto não houver
essa decisão, não abrir inscrições, confirmar emails ou alterar contas reais.
Não apontar o harness local à aplicação/Supabase. A integração autorizada deverá
usar as sessões reais A/B/C, respeitar os horários e registar controlo positivo
servidor, recusa do terceiro e não entrega de broadcasts diretos. Não manipular
relógios ou prazos alojados para facilitar o teste.

Sem commit/push/PR, alteração remota ou publicação desta correção; diff local
disponível para revisão. Recuperação local é retirar apenas a alteração do
observador se houver regressão demonstrada, preservando os controlos servidor.
