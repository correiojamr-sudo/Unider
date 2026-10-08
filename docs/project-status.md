# Estado e trabalho pendente

## Correções A01–A05 aceites localmente em 08/10/2026

Revisão de `5fcd34b4eaa6b5cd4fa8681817128a4c6bdfb33f`, a pedido do proprietário,
apenas para identificar e registar problemas. **Nenhuma correção nesta revisão.**
O [registo A01–A05](validation/2026-10-05-open-findings.md) guarda prioridades,
evidência, limites e critérios de aceitação: autoaprovação de sugestões, corrida
ao cancelar a fila, colisão de IDs de mensagens, logout com sala purgada e
pedidos pendentes no lobby. A revisão original não os corrigiu; a sequência
posterior foi concluída, revista e aceite localmente em 08/10. Ver a
[entrega integrada A01–A05](validation/2026-10-08-findings-fixes.md), com os
ficheiros, testes e limites. A01–A04 passaram revisão independente; A05 passou
revisão da Coordenação e regressões de timeout/respostas antigas.

Verificação final: **101 testes passaram, zero falhas, dois excluídos** no gate
com as cinco fixtures Chrome. Os dois testes de concorrência excluídos de PGlite
passaram separadamente numa base PostgreSQL 18.6 local descartável:
**18 testes passaram, zero falhas/exclusões**. Lint, build e Deno das quatro
Functions passaram. O build usou configuração pública sintética, não publicável.

Existe agora a migration incremental
`20261006141924_secure_suggestions_and_match_intents.sql`. **Não foi aplicada
ao Supabase alojado.** Nenhum deploy ou configuração remota foi realizado.
O contrato de emparelhamento exige UUID/dia e é incompatível com os RPCs antigos;
seguir o [plano de lançamento](operations/release.md), apenas com autorização.
CI da nova revisão e validação alojada continuam separados da aprovação local.
Os registos U01–U06 e dos serviços abaixo são históricos, não o estado do novo diff.

## Auditoria funcional de 05/10 — atualização posterior à organização

Base local confirmada: `main` em `07c8bb2d529b2968317442b7dc8e13a09b537908`.
A [auditoria funcional](validation/2026-10-05-site-audit.md) identifica 12 problemas
no código/interface e quatro riscos ainda por reproduzir ou validar em serviços.
A sequência U01–U06 foi implementada e revista localmente, com uma área escritora
de cada vez. A entrega local foi validada antes de qualquer commit ou push.
Em 05/10, o proprietário autorizou a criação da branch
`fix/unider-functional-recovery`, commit e PR, sem merge ou deploy. A publicação
usa o prefixo `[CF-Pages-Skip]` no commit para impedir o preview automático Pages,
sem desativar o CI GitHub nem alterar configurações remotas. Os registos de
serviços abaixo continuam datados; não representam validação do código novo
publicado. O PR permanece rascunho enquanto faltar a validação alojada.

### Correções aceites pela Coordenação

- **U01 aceite em 05/10:** F01–F04 e F08 corrigidos no diff local sobre a base
  acima. Pré-fila persistente/cancelável, horários coerentes, ausência de Presence
  público, recuperação de erro nas sugestões e preservação de salas. Revisão do
  código, contratos e testes concluída. Gate padrão: 32 testes passaram, um
  excluído (concorrência PostgreSQL); lint/build passaram. Browser 390×844 passou
  com serviços simulados. [Entrega e limites](validation/2026-10-05-lobby-fixes.md).
- **U02 aceite:** saída em todas as fases, recuperação explícita após falha,
  denúncia sem confirmação fictícia e isolamento de respostas antigas.
  [Entrega e limites](validation/2026-10-05-chat-recovery.md).
- **U03 aceite:** email normalizado, OTP/reenvio, erros recuperáveis e proteção
  da sessão/credenciais contra operações antigas, incluindo logout.
  [Entrega e limites](validation/2026-10-05-auth-fixes.md).
- **U04 aceite:** recuperação autorizada do buffer disponível após reconexão,
  com deduplicação, sem renovar TTLs ou permitir escrita cliente.
  [Entrega e limites](validation/2026-10-05-chat-history.md).
- **U05 aceite:** informação de retenção coerente, modais acessíveis por teclado,
  nomes de controlos, ecrãs pequenos e identidade Unider/pt-PT.
  [Entrega e limites](validation/2026-10-05-interface-fixes.md).
- **U06 aceite:** configuração pública validada, diagnóstico de arranque,
  relógio do lobby confirmado/limitado e preparação da integração.
  [Entrega, matriz e autorizações pendentes](validation/2026-10-05-integration-readiness.md).

### Verificação final da Coordenação, em 05/10

Sobre o conjunto atual, após a última revisão: **80 testes passaram, zero falhas,
um excluído** (concorrência PostgreSQL, não comprovada por PGlite). As cinco
fixtures Chrome usaram serviços simulados e bloquearam pedidos externos.
Lint passou sem avisos, build TypeScript/Vite passou e Deno verificou as quatro
Functions com lock congelado e cache existente. O build final gerou chunks JS de
223,46 e 340,75 kB, sem o aviso de chunk acima de 500 kB observado anteriormente.
O `dist` contém configuração pública **sintética: não é um artefacto publicável**.
Os timeouts intermitentes do lobby observados durante as entregas ficam registados
em U04/U06; a execução final da Coordenação passou sem os reproduzir.

As novas Functions `get-room-messages` e `get-server-time` só existem localmente.
Não há migration nova nestas correções; não reaplicar o bootstrap ou SQL histórico.
O CI deste diff, SMTP/OTP real, canais privados A/B/C, Redis concorrente,
ban/eliminação e retenção alojada continuam pendentes. Publicação GitHub e deploy,
identidades/dados/emails de teste e limpeza exigem autorização específica.
A aprovação local não é uma decisão de abertura da plataforma.

### Leitura alojada em 05/10, sem alterações

Supabase `ymzcsoyylrpkdflnlvkg` ativo; Functions `send-message` e `report-room`
ativas, versão 2, JWT ligado. Histórico continua com o bootstrap consolidado.
Consulta às 14:37 UTC: zero contas Auth, salas abertas e entradas de fila.
Cron `purge-old-reports` ativo a cada cinco minutos, execução concluída às
14:35 UTC e zero falhas nas 24 horas anteriores. Estas observações não provam
login, entrega privada ou ligação Functions/Redis.

## Registo anterior

Registo organizado em **2026-10-05**. A base GitHub foi confirmada neste dia:
`main` em `ac042b3ff6e0c4d008fc1a7425049937055702c1`, merge do PR #6.
As observações dos serviços abaixo datam de **2026-10-03**, não foram repetidas
durante a organização documental. Não constituem certificação de lançamento.

## Código integrado

O PR #6 integrou restrições de escrita direta, consentimento via RPC, autorização
de salas privadas, handlers servidor de envio/denúncia, Redis com deduplicação,
ciclo de vida e regressões. A pasta de revisão antiga corresponde aos ficheiros
acompanhados dessa base, excluindo quebras de linha; não há código divergente
nesses ficheiros a transportar manualmente.

A organização atual separa modais de páginas, substitui o README do template,
preserva a especificação inicial como histórica e introduz instruções/guias.
Não altera regras do chat, migrations, dependências ou configuração dos serviços.

## Último estado registado dos serviços

- Supabase alvo: `ymzcsoyylrpkdflnlvkg`, Unider Development/pré-abertura.
- Bootstrap consolidado registado como
  `20261003120620_unider_prelaunch_bootstrap_b88fd255`; não reaplicar históricos.
- Functions `send-message` e `report-room`: registadas ativas, versão de
  plataforma 2, JWT ligado, código baseado em `b88fd255`.
- Pages: merge `ac042b3` publicado para testes pré-abertura; não abertura pública.
- Redis criado e segredos guardados pelo proprietário; testes Lua isolados reais
  passaram, mas não demonstram a integração autenticada das Functions.
- Public channels e inscrições estavam desativados na última leitura do painel.
  SMTP personalizado não estava configurado. Nenhuma conta Auth de teste existia
  na última verificação; não assumir que este número continua atual.

Evidência e limites em [validação de 2026-10-03](validation/2026-10-03-hosted-services.md).

## Prioridades propostas, ainda sem atribuição

| Ordem | Resultado a obter | Área provável | Critério para aceitar |
| --- | --- | --- | --- |
| 1 | Entrada controlada para testes | Infraestrutura e Validação, com apoio Backend atribuído | Método autorizado para três sessões reais, sem abrir inscrições nem enfraquecer Auth. SMTP/domínio ou procedimento administrativo escolhido pelo proprietário. |
| 2 | Canais privados e publicação servidor | Backend e Segurança | Dois participantes recebem; terceiro não subscreve; broadcasts diretos WS/REST sem entrega; envio servidor entrega como controlo. |
| 3 | Integração Redis/Functions e falhas | Backend e Segurança | Envios/denúncias concorrentes, retries e falhas controladas sem duplicação ou destruição da prova. |
| 4 | Ciclo de utilização em browsers | Produto e Interface | OTP/termos, refresh, Novo Chat, ambos os votos, saída/reconexão e limites 22:48/22:50 testados. |
| 5 | Ban, eliminação e limpeza completos | Backend e Segurança | Sessões/tokens antigos testados após ações; prova e retenção verificadas; Cron observado. |
| 6 | Preparação da abertura | Infraestrutura e Validação | Gates e testes alojados aceites, emails configurados e decisão explícita de lançamento. |

Estas áreas não são escritas paralelas: a Coordenação escolhe uma tarefa de cada
vez. Reconciliar histórico de migrations antes de futuras alterações de schema.

## Pontos identificados para triagem, não corrigidos nesta organização

- `campus-queue` usa Presence público na interface, enquanto public channels
  foram desativados no ambiente registado. Emparelhamento usa RPCs; confirmar
  impacto visual/operacional antes de remover ou mudar esse canal.
- O HTML ainda tem título de template e `lang="en"`; decidir identidade/metadados
  numa tarefa de interface, não como efeito escondido da arrumação.
- A proposta original menciona PWA; manifesto/service worker não estão presentes
  no mapa atual. Não anunciar capacidade offline/instalável sem implementação.

## Como atualizar este registo

Registar resultado e evidência após aceitação, distinguindo código, CI e ambiente
real. Não guardar segredos, transcripts de chats ou estados internos de agentes.
O estado ativo de tarefas usa a ferramenta nativa/claims quando habilitadas,
não este documento de pendências de produto.
