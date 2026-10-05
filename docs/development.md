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

O fallback de `src/lib/supabase.ts` permite compilar sem configuração real, mas
não permite concluir que login ou serviços funcionam. Usar ambiente autorizado.
Não copiar segredos da pasta antiga nem criar contas para contornar Auth.

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
deno check supabase/functions/send-message/index.ts supabase/functions/report-room/index.ts
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

## Alterações por tipo

- Interface: regressões de estado, lint/build e cenário browser relevante.
- RPC/política/schema: base isolada, papéis/autorizações e concorrência quando
  aplicável; preparar migration nova sem reescrever histórico aplicado.
- Functions: handler com dependências injetadas, type-check e integração real
  quando autorizada; não interpretar mocks como aprovação do alojamento.
- Documentação: links, caminhos, comandos, fontes e ausência de segredos.

Ver [validação](validation/README.md) e [lançamento](operations/release.md).
