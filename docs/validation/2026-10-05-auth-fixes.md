# U03 — Login e ciclo de sessão

Base: `main`, HEAD `07c8bb2d529b2968317442b7dc8e13a09b537908`, com diffs
U01/U02 aceites na pasta principal. Trabalho local em 2026-10-05; nenhum commit,
push, deploy, SQL remoto, conta/email de teste ou configuração alterada.

## Alterações e contratos

- `src/pages/Login.tsx`: endereço completo normalizado; erros PT-PT sem texto
  interno; destinatário confirmado estável; correção de email, OTP 6–10 e reenvio
  explícito com espera local de 60 segundos, sem pedidos automáticos.
- `src/App.tsx`, `src/store/authStore.ts`: subscrição vence leitura inicial antiga;
  falha inicial permite retry; saída confirma RPCs/Auth, conserva contexto em erro
  e não limpa uma identidade nova. Guards de chat U02 preservadas.
- `src/components/modals/TermsModal.tsx`, `SettingsModal.tsx`: consentimento exige
  confirmação; erros/exceções terminam loading; troca de utilizador/desmontagem
  descarta callbacks; eliminação confirmada distingue logout pendente e retry.
- `src/lib/authOperations.ts`, `authSession.ts`, `src/hooks/useAuthOperation.ts`:
  guardas por operação/vida/contexto; transporte com timeout de 10 segundos;
  armazenamento do SDK preparado em memória e confirmado só em sucesso atual.
  Uma sessão substituída por outro separador impede commit de credenciais antigas.
  Notificações passam apenas `changed`, seguido de releitura protegida.
- `tests/auth.test.cjs`, `tests/auth-browser.test.cjs`: regressões locais de helpers,
  SDK instalado, stores e componentes. Extensão atribuída pela Coordenação:
  `tests/lobby-browser.test.cjs` adapta apenas `abortSignal` no mock de termos e
  a expectativa do erro público; mantém os cenários U01.
- `docs/architecture.md`, `contracts.md`, `development.md` e este registo.

Não foram alterados lobby/chat, Functions, migrations, dependências, lockfiles
ou `project-status.md`. Os diffs de terceiros permanecem na pasta partilhada.

## Fontes verificadas

SDK instalado: `@supabase/supabase-js` e `@supabase/auth-js` 2.117.2. Inspeção
de `GoTrueClient` confirmou escrita de sessão em `verifyOtp`, remoção preparada
em falha de `signOut`, códigos de erro e `dispose`. Um teste compara a chave do
cliente principal e do cliente delimitado, incluindo `localhost:54321`: esta
versão deriva-a de `URL.hostname`, sem a porta.

Documentação atual consultada: [login sem password](https://supabase.com/docs/guides/auth/auth-email-passwordless),
[verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp),
[signOut](https://supabase.com/docs/reference/javascript/auth-signout) e
[configuração OTP](https://supabase.com/docs/guides/local-development/cli/config#auth.email.otp_length).
Reenvio passwordless usa `signInWithOtp`; comprimento configurável 6–10. A
consulta do changelog `.md` falhou por transporte/content-type; a página pública
do changelog foi consultada como alternativa. Não houve leitura de configuração
Auth alojada: comprimento, template, SMTP e inscrições continuam por verificar.

## Evidência local

Regressões incluem endereço em maiúsculas/espaços e formatos inválidos; erro,
exceção e retry; destinatário estável/reenvio; mudança de email, OTP, operação,
utilizador e desmontagem; startup com resultado/rejeição antigos; loading; Terms
e Settings com utilizador substituído; saída recusada/offline; contexto novo
preservado; escrita/remoção tardia do SDK e substituição de storage noutro separador.
Browser monta componentes reais em StrictMode com API substituída e verifica
ausência de pedidos externos e erros JavaScript. A notificação tardia após a
operação não leva uma sessão null antiga; leituras iniciadas por aviso também
são descartadas quando surge uma identidade mais recente.

Gates finais sobre U01/U02/U03, usando o npm CLI existente indicado na atribuição:

| Comando | Resultado observado |
| --- | --- |
| `npm test`, com `UNIDER_TEST_PLAYWRIGHT` e `UNIDER_TEST_BROWSER` existentes | 57 testes: 56 passaram, 0 falhas, 1 omitido (concorrência PostgreSQL; PGlite). Auth/lobby/chat em Chromium 154.0.8037.95, sem pedidos externos. |
| `npm run lint` | Código de saída 0, sem avisos. |
| `npm run build` | TypeScript e Vite passaram; aviso de bundle maior que 500 kB (553,55 kB JS, 161,30 kB gzip). |
| `git diff --check` | Código de saída 0; sem problemas de whitespace. |

Execuções de Node/Vite foram elevadas apenas após `spawn EPERM` do sandbox;
nenhuma ferramenta instalada. O primeiro gate conjunto encontrou a fixture
U01 incompatível com o erro público/cancelamento de Terms; após a adaptação
local atribuída, todos os cenários de browser passaram. A regressão também
verifica logout pendente quando chega uma sessão nova para o mesmo utilizador.
O índice Git permaneceu vazio e HEAD/branch mantiveram-se; diff local e ficheiros
novos estão disponíveis, sem commit. As alterações documentais partilhadas
preservam os conteúdos U01/U02, pelo que o diff contra HEAD contém essas entregas.

## Limites e operação

Fixtures não comprovam login, envio/entrega real de email, SMTP, revogação alojada,
JWTs após eliminação ou efeitos Realtime/Redis. PGlite não prova concorrência
PostgreSQL; o cenário correspondente exige PostgreSQL isolado/CI. Deno não foi
executado: Functions estão fora do âmbito e não foram modificadas.

Não há migration nem passo remoto desta entrega. Validar depois, em ambiente
autorizado, template/tamanho OTP, reenvio, entrada real, refresh, logout offline
e sessões após eliminação. A proteção de armazenamento usa as opções do SDK e
a chave padrão da versão instalada; alterações dessa configuração exigem rever
a derivação. A configuração pública continua duplicada no helper, ponto U06.
Logout não invalida antecipadamente um access token já emitido; a autorização
servidor e os seus prazos mantêm-se. Cancelar pedidos não desfaz efeitos já aceites.
