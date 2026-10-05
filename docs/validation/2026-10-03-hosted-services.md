# Evidência alojada histórica — 2026-10-03

Resumo técnico dos relatórios de preparação/validação produzidos em 2026-10-03,
preservados na pasta local da revisão. Organizado em 2026-10-05 sem repetir
consultas ou testes aos serviços. Não representa estado atual certificado.

Base: PR #6, handlers `b88fd255cf8876d6da3adb96f489ae57544404a3`, merge
`ac042b3ff6e0c4d008fc1a7425049937055702c1`. Supabase alvo
`ymzcsoyylrpkdflnlvkg`. Não foram alterados os serviços na organização documental.

## Preparação registada

- Projeto vazio preparado com bootstrap consolidado
  `20261003120620_unider_prelaunch_bootstrap_b88fd255`, correspondente aos dois
  SQLs iniciais e à migration segura, numa transação com guarda de projeto vazio.
- Functions de envio/denúncia registadas ativas, versão de plataforma 2, JWT
  ligado e bundles correspondentes à fonte revista.
- Redis criado, eviction desativada e segredos guardados pelo proprietário;
  os valores não foram lidos/expostos.
- Public channels e novas inscrições desativados na última leitura; confirmação
  de email ligada e sign-ins anónimos desligados. SMTP personalizado desativado.
- PR #6 integrado e Pages publicado para testes por autorização do proprietário,
  não como abertura pública. Gates GitHub registados verdes nessa base.

## PostgreSQL real — cenários transacionais passaram

Fixtures com papéis PostgreSQL reais verificaram consentimento, permissões,
membership, recusa do terceiro, RPCs exclusivos do servidor, denúncia idempotente,
ban e eliminação sem perda da prova. Dados sintéticos foram anulados por ROLLBACK.

Teste de retenção: denúncia de 31 dias removida/29 preservada; sala terminada há
25 horas removida/23 preservada; lease de fila vencido removido. Consulta final
registou zero contas/salas/denúncias. Não equivale a sessões Auth/JWT reais.

`purge-old-reports` estava ativo a cada cinco minutos; consulta registou 16
execuções bem-sucedidas, última às 13:25 UTC desse dia. Isto comprova a observação
do agendamento naquele momento, não a continuidade até hoje.

## Redis real — cenários isolados passaram

Foi usado o `appendScript` exato, com conteúdo sintético e prefixo único
`qa:unider:20261003:`. Append inicial e retry conservaram um registo; TTLs de
buffer/metadados eram 300/600 segundos. Token errado não acrescentou mensagem nem
libertou lock alheio. Oito aquisições concorrentes tiveram um vencedor; oito
replays deixaram uma mensagem. A quota recusou o 201.º identificador.

A ausência do buffer foi simulada apagando apenas a chave sintética de transcript;
o retry manteve deduplicação sem o recriar. Não foi esperado o TTL completo.
Todas as chaves explicitamente criadas para esse teste foram removidas; não se
apagaram chaves de aplicação.

Não comprova segredos das Functions, corrida HTTP envio/denúncia, integração
autenticada nem recuperação real depois de falha de entrega/gravação.

## Realtime — prova parcial

Probe sem sessão real: primeira recusa privada foi `MissingPartition`, não
contada como autorização correta. Inspeção confirmou partição da data.
Segunda tentativa: privado `Unauthorized`, público `PrivateOnly`.

REST privado e público responderam 202, mas não existiam participantes subscritos
para observar entrega. Resultado inconclusivo para publicação exclusiva servidor.
Políticas consultadas incluíam `unider_receive`, `unider_read_guard` e
`unider_write_guard`, sem política permissiva INSERT cliente para salas.

A análise do código oficial naquela data indicava que o lote REST pode retornar
202 ignorando envios privados sem permissão. Não prova a versão do serviço
alojado. Aceitar o teste pela não entrega observada e controlo positivo servidor,
não apenas por exigir HTTP 403.

Referências usadas na análise histórica:

- [Autorização Realtime](https://supabase.com/docs/guides/realtime/authorization)
- [Protocolo Realtime](https://supabase.com/docs/guides/realtime/protocol)
- [Controller oficial](https://github.com/supabase/realtime/blob/main/lib/realtime_web/controllers/broadcast_controller.ex)
- [Batch broadcast oficial](https://github.com/supabase/realtime/blob/main/lib/realtime/tenants/batch_broadcast.ex)

Os links `main` podem mudar; o relatório é histórico e não atribui uma versão
imutável do código upstream nem certifica o alojamento.

## Bloqueio e trabalho não concluído

Não havia contas/sessões Auth reais na consulta final. Não foram abertas inscrições
nem criadas contas confirmadas para contornar o bloqueio. Faltavam três sessões
autorizadas e uma decisão sobre email/procedimento de teste.

Continuam sem prova completa neste registo: dois participantes/terceiro,
broadcasts diretos WS/REST sem entrega, ligação Functions/Redis, concorrência
envio/denúncia, falhas reais, ciclo entre browsers e ban/eliminação com tokens
emitidos antes da ação. Ver [checklist](README.md).

Os relatórios originais citam fixtures/probes auxiliares fora do repositório;
esta organização não os incorpora nem os disponibiliza como comandos aprovados
para executar num serviço real. Para repetir, preparar teste revisto e autorizado.
