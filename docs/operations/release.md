# Serviços e lançamento coordenado

## Antes de tocar num serviço

Confirmar projeto, versão, histórico, backup/recuperação e autorização da operação.
Esta documentação não concede permissão para deploy, SQL, criação de contas,
alteração de segredos, abertura de registos, compras ou limpeza de dados.
Não alterar o outro projeto Supabase. Não expor credenciais nas evidências.

## Configuração por camada

| Camada | Configuração | Onde fica |
| --- | --- | --- |
| Frontend Pages | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Ambiente do build; valores públicos no browser. |
| Functions | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Ambiente servidor fornecido pela plataforma; nunca frontend. |
| Buffer Redis | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Segredos das Functions; token com permissões necessárias, não read-only. |
| Realtime | Canais de sala privados, leitura autorizada, sem escrita cliente | Configuração alojada e políticas em migrations. |
| Auth/email | SMTP autorizado e configuração OTP | Painel/Auth; segredos SMTP não pertencem ao Git. |
| Retenção | `purge_old_reports`, Cron | Schema e observação de `cron.job_run_details`. |

O frontend continua em Cloudflare Pages: comando do projeto `npm run build`,
saída `dist`, fallback SPA em `public/_redirects`. Não transformar a aplicação
num Worker. O build usa as variáveis Vite; alterá-las exige novo build para
alterar o destino do frontend servido.

## Cuidado particular com a instalação pré-abertura

Em 2026-10-03 foi registado no projeto `ymzcsoyylrpkdflnlvkg` um bootstrap
consolidado:

`20261003120620_unider_prelaunch_bootstrap_b88fd255`

Esse registo representa o conteúdo dos dois ficheiros iniciais e da migration
segura `20261002231850_secure_chat_lifecycle.sql`. Não equivale a três entradas
independentes no histórico remoto. Reaplicar esses SQLs ou executar `supabase db
push` sem comparar/reconciliar históricos pode falhar ou repetir operações.

Antes de adotar deploy CLI, inspecionar oficialmente schema/histórico, preparar
um plano de reconciliação revisto e preservar o registo do conteúdo aplicado.
Não reparar o histórico automaticamente nesta documentação, nem editar SQL já
aplicado. Para migrations novas usar o fluxo atual da skill/CLI e confirmar
comandos com `--help`.

## Ordem para uma alteração de contrato

1. Preparar ambiente autorizado de validação, plano de recuperação e, se a
   alteração for incompatível, janela de manutenção acordada.
2. Aplicar apenas a migration nova/revista correspondente à base confirmada.
3. Publicar as quatro Functions (`send-message`, `report-room`,
   `get-room-messages` e `get-server-time`) com `_shared`, mantendo verificação JWT e
   configuração Redis coerente.
4. Validar contrato servidor, permissões privadas e efeitos dos envios.
5. Publicar Pages correspondente e testar browsers/entrada/ciclo completo.
6. Abrir inscrições apenas após decisão explícita e critérios aceites.

Não misturar schema novo com frontend/Functions antigos incompatíveis. Para o
PR #6, a preparação e publicação para testes já foram registadas; a ordem acima
não é uma instrução para reaplicá-lo hoje.

U04 acrescenta `get-room-messages`, sem migration nem alteração de configuração
remota. Quando houver autorização específica para publicação, publicar primeiro
esta Function com os segredos servidor existentes e verificação JWT mantida;
validar JWT real, recusas e leitura do buffer antes de publicar o frontend U04.
Um frontend U04 publicado antes da Function apresenta erro de recuperação com
retry; não recupera por acesso direto ao Redis. A função lê sob o lock comum,
com autorização `message`; não deve fechar a sala nem renovar TTLs dos dados.
Validar reconexão real entre duas sessões, broadcasts intercalados, buffer
expirado, sala fechada/ban/termos e preservação da prova de denúncia. Mocks locais
não aprovam esses efeitos alojados. Nenhum deploy foi efetuado nesta entrega;
não reaplicar o bootstrap nem os três SQL históricos para publicar a Function.

U06 acrescenta `get-server-time`, apenas local nesta entrega. Publicá-la antes
do frontend U06, com JWT ligado; confirmar resposta ISO autenticada, ausência
de mutações e falha sem sessão. Não precisa de Redis nem de schema novo.
Sem essa Function ou sem confirmação recente, o frontend conserva a sala/intenção
mas bloqueia nova entrada e mostra «Horário por confirmar». A amostra da Function
não substitui hora/prazos PostgreSQL. Publicar Pages exige configuração pública
válida: o preflight recusa env ausente/URL inválido/chave secreta. O build CI/local
com fixtures sintéticas não é um artefacto de release. Não abrir inscrições.
Consultar a [matriz U06](../validation/2026-10-05-integration-readiness.md) antes
de decidir publicação/testes reais; esta entrega não realizou deploys.

Em falha, impedir novas correspondências pelo mecanismo autorizado e corrigir
em frente. Não restaurar permissões inseguras, broadcasts cliente ou inserção
direta de denúncias para fazer o frontend antigo funcionar.

## Publicação futura das correções A01–A04

O candidato local de 08/10 acrescenta a migration
`20261006141924_secure_suggestions_and_match_intents.sql`. Não foi aplicada num
serviço. É incompatível com os RPCs antigos sem argumentos de emparelhamento:
o novo frontend envia `p_intent` e `p_day` tanto na entrada como no cancelamento.
O novo contrato de mensagens usa `(sender_id, id)` no histórico e na interface.

Quando houver autorização específica, confirmar primeiro projeto/histórico e
backup, reconciliando o bootstrap consolidado acima sem reaplicar migrations
históricas. Preparar a publicação fora da janela de conversas e suspender novas
entradas pelo mecanismo autorizado. A migration preserva as tabelas públicas,
acrescenta metadados privados de intenção e restringe INSERT de sugestões a
`user_id`/`suggestion`; aprovação administrativa continua a usar autoridade
servidor. Salas existentes não são reabertas nem prolongadas pela migration.
Entradas antigas da fila sem intenção são descartadas na próxima reconciliação.

Aplicar apenas esta migration sobre a base confirmada, publicar
`get-room-messages` com JWT mantido e publicar o frontend correspondente como
uma sequência coordenada. Evitar misturar clientes/RPCs de versões diferentes:
clientes antigos falham na entrada/cancelamento após a remoção dos RPCs antigos;
clientes novos falham contra schema antigo. Validar INSERT comum, tentativa de
autoaprovação, aprovação administrativa/leitura, cancelamento nas duas ordens,
retry tardio, nova intenção, logout após purga e mensagens com UUID igual entre
participantes em sessões reais autorizadas.

Em falha, conservar entradas suspensas e corrigir em frente. Não reintroduzir
os RPCs antigos nem permissões de aprovação cliente como rollback de conveniência.
Um restauro de backup exige plano separado e autorizado, incluindo efeitos em
denúncias/contas recebidas entretanto. O [registo local A01–A04](../validation/2026-10-08-backend-findings-fixes.md)
descreve evidência e limites; não autoriza deploy nem certifica serviços alojados.

## Email e entrada de teste

A existência de um domínio não configura SMTP por si só. Decidir domínio,
fornecedor e verificação do remetente antes de alterar Auth. A configuração
personalizada não está concluída no último registo. Confirmar disponibilidade
e limites atuais no fornecedor antes de escolher/comprar.

Para validação são necessárias três identidades/sessões autorizadas. Não abrir
signups nem confirmar emails fictícios por conveniência sem decisão explícita.
Se for escolhido um procedimento administrativo para contas de teste, limitar
identidades, ambiente, duração, credenciais e limpeza; não publicar um endpoint
administrativo de conveniência.

## Critério de pronto

Gates verdes são necessários, mas não substituem a
[checklist alojada](../validation/README.md). Registar versão, ambiente e data.
A mera presença dos segredos não prova a ligação Functions/Redis; REST 202 não
prova entrega; SQL com papéis simulados não prova login/Auth JWT real.
