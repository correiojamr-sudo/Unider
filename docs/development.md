# Desenvolvimento e verificações locais

## Preparação

Usar Node.js 24, como o CI, e npm. A partir da raiz:

```sh
npm ci
```

Criar `.env.local` a partir de `.env.example` e preencher apenas as variáveis
públicas do cliente. O ficheiro local não entra no Git.

```sh
npm run dev
```

`VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` são incorporados no bundle público.
O nome da segunda variável mantém compatibilidade com o cliente atual. Nunca
colocar `service_role`, Redis ou SMTP em variáveis `VITE_*`.

`publicConfig.ts` centraliza a configuração para o cliente principal e Auth
scoped, mantendo as guards de sessão. Não há fallback localhost/chave fictícia.
Build sem env ou com URL/chave inválida falha no preflight Vite, antes do bundle.
Aceita chave publishable ou JWT `anon`; recusa chaves secretas/service_role com
diagnóstico sem valores. A validação estrutural não prova ligação ao projeto.
Em dev, configuração inválida permite mostrar um diagnóstico recuperável, sem
carregar App/Supabase; preencher env, reiniciar Vite e recarregar. Os valores
inválidos são suprimidos do módulo servido. Não copiar segredos da pasta antiga.

## Gates

```sh
npm test
npm run lint
npm run build
```

O build executa TypeScript e Vite; a saída `dist/` é gerada e ignorada.
`npm run preview` serve o build local. O lint pode ter avisos preexistentes:
registar avisos e não os esconder como parte de uma alteração documental.

Para Functions, com Deno 2:

```sh
deno check --frozen-lockfile supabase/functions/send-message/index.ts supabase/functions/report-room/index.ts supabase/functions/get-room-messages/index.ts supabase/functions/get-server-time/index.ts
```

`deno.lock` é versionado. Não regenerar dependências sem necessidade e revisão.

## Testes de base de dados

Sem `UNIDER_TEST_DATABASE_URL`, `npm test` usa PGlite isolado. Não comprova
transações concorrentes. Para a variante PostgreSQL, preparar uma base local
nova e descartável, chamada `unider_review`, e uma ligação superuser no ambiente
`UNIDER_TEST_DATABASE_URL`. Depois executar `npm test`.

O harness recusa hosts não locais e outros nomes. Cria papéis/objetos e espera
uma base sem fixtures anteriores. Nunca apontar para Supabase ou uma base da
aplicação. As funções Auth/Cron do fixture são stubs e não autenticação real.

O workflow `.github/workflows/review-regressions.yml` usa PostgreSQL 17 e corre
também o teste de 32 pedidos de matchmaking concorrentes, além de lint/build.
O job `edge-types` faz type-check Deno independentemente.

O build CI define apenas fixtures públicas sintéticas explícitas; não publica
esse `dist`. Não há exceção por `CI=true`. Para reproduzir um build estrutural
sem ambiente alojado, usar URL `https://unider-build.invalid` e chave sintética
`sb_publishable_unider_ci_fixture_only` nas duas variáveis públicas da sessão.
Esse artefacto não é publicável: para release configurar os valores públicos
do projeto autorizado e voltar a compilar. `.env.example` deixa ambos vazios.

## Alterações por tipo

- Interface: regressões de estado, lint/build e cenário browser relevante.
- RPC/política/schema: base isolada, papéis/autorizações e concorrência quando
  aplicável; preparar migration nova sem reescrever histórico aplicado.
- Functions: handler com dependências injetadas, type-check e integração real
  quando autorizada; não interpretar mocks como aprovação do alojamento.
- Documentação: links, caminhos, comandos, fontes e ausência de segredos.

Ver [validação](validation/README.md) e [lançamento](operations/release.md).

## Regressões de autenticação

`tests/auth.test.cjs` executa helpers, store real e o SDK Auth instalado contra
transporte/armazenamento locais. `tests/auth-browser.test.cjs` monta Login, App,
Terms e Settings reais com API isolada e bloqueia pedidos fora da origem local.
Não carrega o cliente configurado da aplicação nem envia OTP real.

Os testes de browser são opcionais quando o runtime não está disponível. Para
executá-los sem instalar ferramentas, definir `UNIDER_TEST_PLAYWRIGHT` para o
módulo Playwright já instalado e `UNIDER_TEST_BROWSER` para Chrome, depois usar
`npm test`. A execução U03 e os seus limites estão registados em
[validação de autenticação](validation/2026-10-05-auth-fixes.md).

## Regressões de histórico de chat

`tests/chat-history.test.cjs` verifica snapshot + broadcasts intercalados,
deduplicação/ordem, retry manual e respostas de subscrições/contextos antigos.
`tests/chat-history-handler.test.cjs` executa o handler real com Auth/RPC/Redis
simulados: autorização, leitura limitada com fencing, buffer vazio, dados
inválidos e falhas. A inspeção do script comprova que não escreve no buffer ou
nos TTLs; o mock não comprova execução Lua nem concorrência num Redis alojado.

`tests/chat-browser.test.cjs` monta Chat/Lobby/hooks/store reais e simula perda
de uma mensagem durante interrupção, recuperação após `SUBSCRIBED`, broadcasts
durante snapshot, erros/retry e troca de sala/utilizador/instância. Bloqueia
pedidos externos e verifica que saída/denúncia continuam disponíveis durante a
leitura. Usa o mesmo runtime opcional de browser acima. Ver
[validação de histórico](validation/2026-10-05-chat-history.md).

## Configuração e relógio — U06

`tests/config.test.cjs` exercita o validador e o preflight Vite real;
`tests/config-browser.test.cjs` verifica o bootstrap real em dev sem App/SDK,
diagnóstico e ausência de valores secretos/pedidos externos. `tests/clock.test.cjs`
valida ISO/RTT/frescura/contexto, limites de Lisboa, descarte de trabalho antigo
e handler Auth sem mutações. A fixture de lobby conserva os cenários U01 e
acrescenta dia do dispositivo desviado, refresh, falha/stale, regresso à sala e
resposta da identidade anterior. Cada fixture browser tem cache Vite própria
para evitar interferência entre os processos do gate. Testes alojados não são
executados por estes scripts. Ver [matriz U06](validation/2026-10-05-integration-readiness.md).
