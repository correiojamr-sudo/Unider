# Sincronização Supabase — 10/10/2026

## Âmbito e versão

Atualização autorizada expressamente pelo proprietário apenas no projeto
`ymzcsoyylrpkdflnlvkg` (Unider Development). Código publicado no PR #10,
integrado em `main`: `7695f61d197276766a89ec89f1754e093ad3c4b3`.
Pasta local sincronizada por fast-forward na branch existente, sem diferenças
de conteúdo relativamente ao candidato `9b2dbbc`.

Não houve deploy Cloudflare, alteração do outro projeto, criação de contas,
envio de emails, alteração de passwords/segredos ou preenchimento de dados
pessoais/consentimento por terceiros. As inscrições já estavam ativadas no
painel; essa opção não foi alterada. Confirmação de email continua ativa.

## Migrations aplicadas e histórico

Bootstrap `20261003120620_unider_prelaunch_bootstrap_b88fd255` preservado;
os três SQL históricos não foram reaplicados. Incrementais aplicadas por ordem:

| Ficheiro local | Versão registada no projeto |
| --- | --- |
| `20261006141924_secure_suggestions_and_match_intents.sql` | `20261010175249` |
| `20261008181527_deterministic_room_end.sql` | `20261010175250` |
| `20261010145007_adult_terms_v2.sql` | `20261010175251` |
| `20261010170027_private_registration_details.sql` | `20261010175405` |

O conector atribui timestamps próprios. Houve colisão do timestamp da terceira
entrada com a segunda: o SQL dos termos foi confirmado, mas o registo no histórico
falhou. Não se repetiu o SQL. Após verificar as definições exatas dos dois RPCs,
coluna e grants, registou-se o conteúdo original em `schema_migrations` como
`20261010175251`, numa transação com pré-condições. Histórico final verificado:
bootstrap e quatro incrementais, sem entradas duplicadas por nome.

**Não executar `supabase db push` cegamente:** os nomes/timestamps locais e remotos
continuam distintos. Este mapa é evidência da aplicação, não autorização para
reescrever o bootstrap ou reparar automaticamente o histórico.

## Functions e Auth

Publicadas `send-message` v3, `report-room` v3, `get-room-messages` v1 e
`get-server-time` v1. Todas ACTIVE, `verify_jwt: true`. Fonte recuperada pelo
conector comparada ao código local, incluindo `_shared/chat.ts`: coincide após
normalização de finais de linha. Deno check com lockfile congelado passou nas quatro.

Auth: submetido e guardado mínimo de password de 12 caracteres; o campo reaberto
é redigido pelo browser, pelo que não se afirma confirmação independente do valor
numérico nem teste de rejeição de password curta pela API. Site URL corrigido de
`http://localhost:3000` para `https://unider.pages.dev`, confirmado após reload.
Redirects exatos `/login` e `/recuperar-password` guardados e verificados, sem
wildcards. Templates padrão de confirmação e recuperação mostram
`ConfirmationURL`. SMTP personalizado permanece desligado; personalização de
templates exige SMTP neste projeto. Não se inventaram credenciais.

## Evidência alojada

- Antes/depois: uma conta Auth e um perfil preservados. Antes: zero salas abertas,
  fila e denúncias. `account_details` permanece vazio: dados da conta antiga não
  foram inventados. O utilizador tem de aceitar os termos atuais pela app.
- `account_details`: RLS ativa, SELECT apenas do próprio; sem INSERT cliente nem
  SELECT anónimo. Trigger de criação Auth aponta para `handle_new_user` atualizado.
- Sugestões: INSERT authenticated limitado a `user_id` e `suggestion`.
- RPCs antigos de fila ausentes; assinaturas UUID/data presentes.
- RPCs de autorização/persistência sem EXECUTE cliente; denúncias sem INSERT
  cliente. Helper de fim determinístico instalado.
- Realtime ativo e acesso a canais públicos desligado, confirmado no painel.
  Políticas restritivas `room:%` de leitura e de bloqueio da escrita permanecem.
- Quatro POST sem JWT devolveram HTTP 401. Isto não prova execução autenticada.
- Cron de cinco minutos ativo, com execução `succeeded` às 17:55 UTC após a
  atualização. Existe também tarefa diária preexistente, não alterada.
- CI `Review regressions` do candidato `9b2dbbc`, run `38072239484`: success.
  Os gates locais anteriores pertencem ao mesmo conteúdo; não se repetiram todos
  os testes apenas para documentar o deploy.

Advisor: tabelas internas sem políticas cliente são deliberadas. RPCs definer
autenticados têm autorização interna e são contratos intencionais. O aviso sobre
`rls_auto_enable` refere um event trigger da plataforma, não função RPC normal;
não se alterou esse objeto. Proteção contra passwords comprometidas desativada:
painel indica recurso Pro, sem upgrade autorizado.

## Recuperação e limites

Snapshot local ignorado em `node_modules/.cache/supabase-sync-20261010/` conserva
definições/grants SQL anteriores e fonte das duas Functions anteriores. **Não é
backup de dados**, não inclui passwords nem JWTs. Não foi demonstrado um restauro
completo. Migrations não apagam contas, perfis ou denúncias; em falha, corrigir em
frente com migration revista, sem repor permissões/RPCs inseguros.

Continuam por executar: login real; registo/confirmar/recuperar email com SMTP;
testes entre participantes A/B e terceiro C; publicação servidor e recusa de
broadcasts diretos; Lua/Redis real, concorrência/retries e persistência; reconexão,
ban/eliminação e fronteiras horárias. Não houve uso do harness contra Supabase.
Não se afirma aprovação de lançamento nem conformidade jurídica.

SMTP padrão só envia para endereços da equipa e não serve o registo público de
estudantes: [documentação oficial](https://supabase.com/docs/guides/auth/auth-smtp).
Próximo bloqueio externo: escolher/configurar fornecedor SMTP e remetente com
credenciais autorizadas, seguido de validação real. Não colocar credenciais no Git.
