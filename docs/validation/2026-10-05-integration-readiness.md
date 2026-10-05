# U06 — configuração, relógio e preparação de integração

Data: 2026-10-05. Pasta principal Unider, branch `main`, HEAD
`07c8bb2d529b2968317442b7dc8e13a09b537908` com diffs U01–U05 aceites pela
Coordenação. U06 preserva esses diffs e entrega alterações locais para revisão;
não é uma certificação de lançamento nem uma versão publicada.

## Objetivo, reprodução e resultado

F12: o cliente principal e Auth scoped tinham fallback localhost/chave fictícia.
Agora usam configuração única validada. Vite recusa build sem env, URL inválido,
chave secreta ou JWT `service_role`, mesmo com `CI=true`. Aceita publishable e
legacy `anon`; só valida estrutura/role, não assinatura, validade nem projeto.
Em dev, o bootstrap mostra diagnóstico e Recarregar antes de importar App/SDK,
com valores inválidos suprimidos. Nenhum valor/credencial consta do diagnóstico.
O getter cliente lê estaticamente só as duas variáveis necessárias; não passa
`import.meta.env` completo. Um build real em memória com variável `VITE_` extra
e marcador sintético comprova que o marcador não entra nos chunks, enquanto a
fixture pública explicitamente referenciada entra. Não foram lidos valores reais.

R03: o lobby calculava horários e invalidava `queueDay` por `new Date()` do
dispositivo, incluindo nas ações. O caso é reproduzível com dia/hora desviados.
Agora `get-server-time` valida JWT por `authenticate`/`getUser`, devolve apenas
ISO UTC e não faz SQL/Redis/broadcast. A UI estima hora na receção com RTT/2,
avança por relógio monotónico e limita RTT a 5s/frescura a 90s/contexto Auth.
Consulta inicial, a cada 60s visível e em foco/visibilidade; mínimo 10s entre
tentativas e timeout 5s. Não há pedido de rede por segundo. Os prazos Chat
continuam PostgreSQL; Novo Chat passa a data dessa confirmação para `queueDay`.

Sem amostra recente, entrada automática/nova fica bloqueada; intenção de espera,
sala e mensagens permanecem. Cancelar ou voltar à conversa continua disponível.
Falha numa renovação conserva a amostra anterior enquanto ainda válida. Hora
estimada é identificada na interface; rede assimétrica/relógio entre camadas
podem introduzir erro e um RPC pode recusar um pedido junto ao limite.

## Ficheiros U06

- Configuração/bootstrap: `vite.config.ts`, `.env.example`,
  `src/lib/publicConfig.ts`, `src/lib/supabase.ts`, `src/lib/authSession.ts`,
  `src/main.tsx`.
- Relógio/gates: `src/lib/serverClock.ts`, `src/hooks/useTimeSync.ts`,
  `src/store/appStore.ts`, `src/pages/Lobby.tsx`; apenas data da nova fila em
  `src/pages/Chat.tsx`/`src/hooks/useChatSession.ts`.
- Function nova: `supabase/functions/get-server-time/handler.ts` e `index.ts`.
- Testes novos: `tests/config.test.cjs`, `tests/config-browser.test.cjs`,
  `tests/clock.test.cjs`. Adaptações das fixtures existentes:
  `tests/auth.test.cjs`, `tests/auth-browser.test.cjs`,
  `tests/lobby-browser.test.cjs`, `tests/chat-browser.test.cjs`.
- CI: `.github/workflows/review-regressions.yml`; build com fixture pública
  explícita, sem bypass; Deno inclui todos os `supabase/functions/*/index.ts`.
- Documentação: arquitetura, contratos, desenvolvimento, release e este registo.

Não houve alteração de dependências, lockfiles, migrations, `project-status`,
branches, commits ou serviços. O diff Git partilhado inclui também U01–U05;
ficheiros novos estão untracked para revisão/staging explícito pela Coordenação.

## Evidência local

Ambiente: Node 24.19.0/Vite 8.3.2, Deno 2.9.6 instalado existente, Chrome
154.0.8037.95; mocks/fixtures sintéticos em loopback, sem contas/OTP ou dados
alojados. Autoridade: atribuição U06 para implementação e testes locais.

| Comando/cenário | Esperado | Observado / limite |
| --- | --- | --- |
| `npm test` com runtime browser existente | Gates U01–U06 sem regressões | 80 passaram, 1 excluído; total 81 incluindo subtestes. Exclusão: concorrência PostgreSQL, pois o harness usou PGlite. |
| `npm run lint` | Sem erros | Passou; sem avisos emitidos. |
| `npm run build` sem env | Recusa antes do bundle | Exit 1 com diagnóstico de configuração pública em falta, sem valores. |
| `npm run build` com fixture pública explícita | Compila SPA Pages em `dist` | Passou, TypeScript/Vite. **O `dist` final é sintético e não publicável.** |
| Deno `check --frozen-lockfile` sobre as quatro entradas | Tipos/imports válidos | Passou; lock não foi regenerado. Não prova execução publicada. |
| Validador/preflight Vite real | Recusar ausente/URL inválido/secreto/service_role; aceitar anon/publishable | Passou, incluindo `CI=true`, sem expor valores. Build em memória confirma ausência de marcador VITE extra não usado. |
| Bootstrap real em Vite/Chrome | Diagnóstico, sem App/cliente/calls ocultas | Passou para falta/secreto/service_role; Recarregar funciona; zero pedidos externos. |
| Relógio/helper/handler | ISO/RTT/frescura/Auth/contexto e ausência de mutações | Passou, incluindo 22:28/22:30/22:48/22:50 em inverno/verão e resposta antiga rejeitada. Auth/SQL/Redis são simulados. |
| Lobby real com dispositivos desviados | Dia servidor, refresh/intenção conservados; falha/stale não concede entrada nem apaga sala | Passou em 390×844, incluindo cancelamento, foco com limite de pedidos e resposta de identidade anterior. |
| Fixtures U02–U05 | Recuperação, retry, guards, votos, teclado e ecrã pequeno preservados | Passaram; não constituem browser/login/email alojados. |

Foram usados npm CLI e Deno já instalados indicados na atribuição. Vite/Node
com subprocessos falharam inicialmente no sandbox com `spawn EPERM`; a execução
local especificamente escalada passou. Não houve instalação. Chrome foi definido
por `UNIDER_TEST_BROWSER` e Playwright por `UNIDER_TEST_PLAYWRIGHT`.
`git diff --check` passou; Git emitiu avisos de normalização CRLF→LF em ficheiros
existentes, sem erro de whitespace. Não foi feita normalização ampla.

Durante adaptação, a fixture lobby teve dois timeouts de 5s: regresso ao lobby
antes de cancelar a intenção podia reentrar imediatamente no chat, e uma execução
concorrente falhou na montagem inicial. A preparação cancela antes de regressar;
fixtures usam caches Vite distintas. Nenhum timeout/assert foi alargado/removido.
A execução isolada e o gate conjunto passaram. A causa do segundo timeout não
ficou demonstrada; manter visibilidade desta limitação. U04 já registara outro
timeout lobby, que passou isolado e na repetição.

Preparação/limpeza: apenas memória, sessionStorage de fixtures e saídas locais
ignoradas em `node_modules`/`dist`. Browsers/servidores encerrados; nenhuma
identidade, chave Redis, email ou dado remoto criado. Não executar o harness
automático contra Supabase; o teste PostgreSQL requer `unider_review` local
descartável e autorização para a preparar. A configuração sintética não é usada
para comunicar com qualquer serviço.

## Matriz R04 — local, alojado parcial e pendente

### Revisão final da Coordenação

U01–U06 aceites localmente. Após o ajuste final dos acessos estáticos às variáveis
públicas, a Coordenação voltou a executar o gate completo: 80 testes passaram,
zero falhas, um excluído (PostgreSQL concorrente); as cinco fixtures Chrome
passaram sem pedidos externos. Lint terminou sem avisos e o build passou com
chunks JS de 223,46/340,75 kB, sem aviso de chunk acima de 500 kB. Deno verificou
as quatro Functions com `--frozen-lockfile --cached-only`. Não houve mudança de
dependências, migration, conta ou serviço. O `dist` final continua sintético e
não publicável. Esta aceitação não preenche os testes alojados da matriz abaixo.

| Área | Evidência atual | Estado e próximo passo |
| --- | --- | --- |
| Configuração Pages | Leitura U06 via connector Cloudflare em 05/10: projeto `unider`, `unider.pages.dev`, branch `main`, comando `npm run build`, saída `dist`; ambas as variáveis públicas presentes em produção/preview, tipo plain_text. Foram devolvidos apenas metadados/presença. | **Alojado parcial.** Não prova validade/conteúdo das chaves, destino do bundle ou login. Recompilar/publicar apenas com autorização e valores públicos corretos. |
| Estado Supabase | Leitura da Coordenação em 05/10, 14:37:48 UTC: `ymzcsoyylrpkdflnlvkg` saudável; send-message/report-room v2 ACTIVE/JWT; único bootstrap consolidado; zero Auth users/salas abertas/fila. Não repetida por U06. | **Alojado parcial.** Foto daquele instante, não execução Auth/Realtime. |
| Cron | Coordenação: `*/5` ativo; execução concluída 14:35 UTC, sem falhas nas últimas 24h daquela consulta. | **Alojado parcial.** Não prova eliminação/retensão com dados de teste nem futuras execuções. |
| `get-room-messages`, `get-server-time` | Handlers/testes/types locais; não publicados. | **Local comprovado; alojado pendente.** Publicação autorizada das Functions antes de Pages, JWT mantido. |
| SMTP/template/comprimento OTP/inscrições/Realtime privado atuais | Conector Supabase exposto não fornece leitura de configuração Auth/Realtime; não foi usada UI com valores sensíveis. Registos de 03/10 são históricos. | **Pendente de acesso seguro de leitura.** Não concluir configuração atual nem alterar serviços; guardar só opções/metadados. |
| Login/OTP/sessões/browsers alojados | Recuperação/normalização/guards em fixtures locais. | **Pendente de autorização:** três identidades institucionais de teste, método de entrada/SMTP e destinatários exatos; inscrições permanecem fechadas. |
| Canal privado A/B/C e WS/REST | Políticas SQL e mock local; observações históricas parciais. | **Pendente de sessões reais:** A/B recebem servidor, C não lê; membro/terceiro/anónimo não entregam via WS/REST. REST 202 não decide o caso; controlo positivo servidor obrigatório. |
| Redis/Functions/Lua/concorrência/TTL/prova | Handlers com dependências injetadas e leitura Lua inspecionada; evidência antiga Redis isolado. | **Pendente de autorização:** keys/room IDs sintéticos, prazo, falhas controladas, envios/retries/duas denúncias concorrentes, espera TTL real e limpeza. |
| Ban/delete/retensão | Fixture SQL e guards locais; Cron parcial. | **Pendente de autorização:** contas/sessões de teste, mutações limitadas, tokens anteriores, prova conservada e limpeza verificada. |
| PostgreSQL concorrente/CI do diff | CI configurado PostgreSQL 17 e todas as Functions; sem novo push/run remoto. | **Pendente.** O teste concorrente local foi excluído; não atribuir sucesso do CI ao diff não enviado. |

## Checklist de publicação e testes reais (sem executar agora)

1. Rever/aceitar o diff U01–U06 e identificar versão; correr gates sobre essa
   versão. Confirmar autorizações separadas para publicação, ambiente, dados,
   identidades, emails, falhas controladas e limpeza.
2. Preservar bootstrap `20261003120620_unider_prelaunch_bootstrap_b88fd255`.
   Sem schema novo em U06; **não executar `supabase db push` nem reaplicar os
   três SQL históricos**. Se surgirem migrations futuras, reconciliar histórico
   num plano revisto antes de qualquer operação.
3. Publicar/validar as quatro Functions com `_shared`, JWT ligado e configuração
   servidor adequada. get-server-time não usa Redis. Confirmar JWT real,
   recusas e ISO/ausência de mutações; get-room-messages exige Auth/RPC/Redis real.
4. Configurar/verificar apenas valores públicos Pages autorizados e recompilar.
   Descartar como release o `dist` sintético deste gate. Publicar Pages só depois
   das Functions correspondentes; confirmar versão efetivamente servida.
5. Preparar A/B/C em ambiente pré-abertura, com duração/limpeza acordadas; não
   abrir inscrições ou confirmar emails fictícios por conveniência. Executar
   matriz [de integração](README.md) com controlo positivo servidor, incluindo
   relógio de dispositivo errado e sala existente durante falha de hora.
6. Para cada caso alojado registar data/versão/projeto, autoridade/preparação,
   identidades sintéticas, esperado/observado, passou/falhou/inconclusivo,
   limitações e limpeza. Nunca JWT, credenciais ou conversas reais.
7. Login/email real, Redis/Lua concorrente, canais privados, ban/delete/retensão
   e browsers alojados precisam de evidência aceite antes de uma decisão
   explícita de abertura. Não preencher essas caixas com mocks ou CI verde.

Referências atuais consultadas em 05/10: [changelog Supabase](https://supabase.com/changelog),
[chaves públicas/secretas](https://supabase.com/docs/guides/getting-started/api-keys),
[Auth/getUser](https://supabase.com/docs/guides/functions/auth-legacy-jwt),
[headers/JWT](https://supabase.com/docs/guides/functions/auth-headers),
[Vite env](https://vite.dev/guide/env-and-mode) e
[Vite/Pages](https://developers.cloudflare.com/pages/framework-guides/deploy-a-vite3-project/).
O endpoint changelog.md não foi aceite pelo leitor web; consultou-se a página
HTML e documentação atual via connector. Sem mudança de dependências/contratos
JWT existentes em consequência dessas leituras.
