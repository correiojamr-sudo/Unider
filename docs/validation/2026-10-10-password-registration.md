# Login/password e registo privado — entrega local

Atualização de publicação, 10/10: proprietário autorizou commit/push e novo PR.
PR #9 já integrado (`724d420`); este candidato segue na mesma branch, em rascunho,
com `[CF-Pages-Skip]`, sem merge/deploy ou alterações Supabase. As notas de
ausência de commit/push abaixo registam a entrega local anterior à autorização;
o novo PR identifica a versão publicada e o CI correspondente.

10/10/2026. Base `65f2f19c00f9828275481a963cd4d9c55ec893b0`, branch existente
`fix/unider-functional-recovery`. Preservadas as alterações locais anteriores
de Login, testes Auth/acessibilidade e contratos/privacidade/estado; o novo
pedido substitui OTP na interface por email/password. Sem alteração de branch,
dependências, Functions ou migrations históricas.

## Comportamento e segurança

- Login normaliza apenas email; não cria conta nem guarda password no perfil,
  logs ou armazenamento próprio. SDK scoped confirma sessão só de operação atual.
- Registo: nome de uso privado (1–80), nascimento real ISO desde 1900 e >=18
  pela data Lisboa; género masculino/feminino/prefiro não divulgar, esta última
  opção por defeito; password nova 12–128; aceitação explícita e links de leitura.
- Trigger servidor repete validação de domínio/dados/idade/aceitação e grava
  perfil e `account_details` na mesma transação. Recusa dados falsos/nulos/ausentes
  e rollback não deixa uma conta parcial. Isto valida declaração, não idade real
  nem leitura. Género não decide emparelhamento ou autorização.
- Dados iniciais também ficam nos metadados Auth do próprio (podem constar do
  seu JWT). São editáveis ali, mas o snapshot protegido não é alterado por essas
  edições; nunca se utiliza user_metadata/JWT editável para conceder acesso.
- RLS de `account_details`: só SELECT do próprio; escrita cliente recusada,
  administração servidor mantém acesso. Eliminação de conta faz cascade.
  Dados não acrescentados a broadcasts, mensagens ou estados de sala.
- `eligible` exige também conta Auth presente, email confirmado e institucional.
  Ban/termos continuam autoritativos. Contas anteriores mantêm declaração sem
  backfill inventado; não são apagadas para trocar de método de login.
- Registo sem sessão dá aviso condicional sem enumerar existência de contas.
  Reenvio `resend(type:signup)` e recuperação por ligação não criam contas.
  Espera local de 60 segundos não substitui limites do servidor.
- Recuperação pública antes do login; nova password só com sessão autenticada.
  Mudança de identidade limpa campos/avisos e descarta respostas pendentes.
  Cancelamento não desfaz ações já recebidas no servidor, nem uma alteração
  de password afirma logout global de outras sessões.

## Ficheiros e verificações

Frontend: `src/pages/Login.tsx`, novo `src/pages/RecoverPassword.tsx`,
`src/App.tsx`, novo `src/lib/registration.ts`, `src/lib/authOperations.ts`,
`src/lib/legal.ts`. Backend: nova migration
`supabase/migrations/20261010170027_private_registration_details.sql`,
criada pelo CLI 2.119.0, não aplicada no projeto alojado.

Testes: `tests/auth-browser.test.cjs`, `tests/auth.test.cjs`,
`tests/database.test.mjs`, novo `tests/registration.test.cjs`; preservado ajuste
anterior em `tests/accessibility-browser.test.cjs`. Docs: arquitetura, contratos,
preparação jurídica, release, estado e este relatório.

- `npm test` com cinco fixtures Chrome: **107 passaram, 0 falhas, 2 excluídos**
  (concorrência PGlite). Todos os pedidos externos das fixtures são bloqueados.
- `node --test tests/database.test.mjs` em PostgreSQL 18.6 local, base nova
  `unider_review` em 127.0.0.1:25443: **20 passaram, 0 falhas/exclusões**.
  Testa também as duas regressões concorrentes anteriores. Auth/Cron são stubs,
  não prova de Supabase alojado. Cluster só sintético, ignorado em
  `node_modules/.cache/aquecimento-password-pg-20261010`, parado após verificação.
- `npm run lint`: sem avisos após trocar regex de controlos por verificação
  explícita. `npm run build`: TypeScript/Vite aprovados com configuração pública
  sintética; `dist` não publicável. Testes de links/legais e diff check passaram.
- Browser: login sem signup, validação registo, checkbox, dados privados/default,
  registo sem sessão, reenvio/cooldown, recuperação e troca de identidade,
  respostas antigas e rotas reais. SDK instalado com transporte simulado testa
  armazenamento staged em login/signup; nenhuma password/conta/email real usada.

## Limites e lançamento

Sem commit/push/merge/deploy, SQL alojado, configuração remota ou criação de
contas reais. Diff disponível nesta pasta; PR #9 ainda não contém esta mudança.
Skills Supabase e codex-coordinator influenciaram a verificação do contrato,
isolamento dos dados, migration incremental e fronteira local de escrita.

Antes de publicar, autorizar/aplicar migration e frontend coordenados, configurar
SMTP, confirmação, templates `ConfirmationURL`, Site URL/redirects exatos e
política real de password compatível (mínimo 12), limites/CAPTCHA conforme risco.
O mínimo do formulário não protege a API se Auth alojado tiver política fraca.
Testar signup, confirmação, recuperação e links usados/expirados reais,
RLS/eliminação, sessão antiga e bans. Não abrir inscrições como atalho de teste.
Ver [release](../operations/release.md) e [preparação jurídica](../legal-readiness.md).

O pedido de guardar nome/nascimento/género não demonstra necessidade nem
fundamento jurídico. Justificar conservação da data completa versus maioridade,
e género opcional sem uso atual, antes de publicar. A revisão legal pendente
não foi resolvida por testes de código nem pela aceitação de termos.

Fontes atuais: [passwords Supabase](https://supabase.com/docs/guides/auth/passwords)
e [signUp](https://supabase.com/docs/reference/javascript/auth-signup), consultadas
com o changelog em 10/10. Identificada a restrição de personalização de templates
em novos projetos Free com SMTP padrão desde 03/06/2026: exige SMTP personalizado
quando for necessário mudar templates; confirmar situação do projeto antes de
configurar. Não se atualizou SDK/CLI por conveniência.
