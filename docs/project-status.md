# Estado e trabalho pendente

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
