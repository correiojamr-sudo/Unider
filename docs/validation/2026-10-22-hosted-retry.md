# Diagnóstico e preparação de nova tentativa — 22/10/2026

## Estado e autoridade

Após o [resultado inconclusivo](2026-10-22-hosted-result.md), o proprietário
autorizou outra tentativa única com até três contas temporárias e limpeza final.
Pediu também avaliar a remoção do limite horário para testar mais facilmente.
Não foi retirado nenhum limite da app ou alterada configuração remota.

Base `b7a62bc1107d48224d7d34def130e90d96edb479`, branch existente
`fix/unider-functional-recovery`, trabalho anterior preservado. Um agente alterou
apenas runner/testes; a Coordenação reviu, aceitou e acrescentou o código oficial
`InitializingProjectConnection` à classificação sanitizada antes dos gates.

**Nenhuma segunda execução alojada foi feita.** A preparação/revisão não terminou
antes das 22:43 e a cópia local da chave já tinha sido eliminada na limpeza.
O perfil de retry de hoje recusa execução fora da janela. Não está agendada
ou implicitamente autorizada uma execução automática noutra data.

## Evidência read-only posterior à primeira tentativa

Registos Realtime do projeto, com horários convertidos de UTC para Lisboa:

- 22:30:56.605: inicialização da ligação do projeto.
- 22:30:56.693: `MissingPartition`, sem encontrar a partição esperada de mensagens.
- 22:30:56.819: início da criação de partições de `realtime.messages`.
- 22:30:57.020: início do stream de replicação.

Consulta posterior ao catálogo confirmou a existência da partição de 22/10.
Isto aponta para um arranque a frio como causa provável, não prova que fosse a
única causa da falha. Não foi feita criação manual de partições, reinício ou
alteração de policies. Referência: [códigos operacionais oficiais](https://supabase.com/docs/guides/realtime/error_codes).

## Correções locais no procedimento de teste

`scripts/hosted/private-chat-check.mjs` passa a observar A/B/C em conjunto num
orçamento de 20 segundos, com heartbeats limitados. Erros transitórios não terminam
imediatamente a tentativa: o SDK pode recuperar na mesma subscrição. Negação
explícita a A/B falha; C só é considerado bloqueado após negação explícita,
nunca por timeout ou ausência de ligação. Regista fixture/estado/tempo e
código/classe permitidos, sem serializar erros brutos, tokens, claims ou frames.

O SDK instalado 2.117.2 emite broadcasts binários tipo 3 no protocolo Phoenix v2.
O observador anterior só reconhecia JSON, pelo que um envio WS real nesse formato
poderia ser marcado como não confirmado. A nova leitura reconhece ambos os
formatos e tamanhos UTF-8, conservando apenas tópico/ID/codec em memória; o
relatório não inclui texto das mensagens. A regressão usa o serializer instalado,
não apenas um frame inventado pelo mock.

Dois perfis fixos: `original` e `retry-20261022`. O segundo requer seleção
explícita de ID/data, usa outra marca atómica e mantém os limites de três contas,
alvo e horário. O primeiro mantém a marca existente. Datas/IDs arbitrários não
concedem autorização. Modo de plano seguro:

```sh
node scripts/hosted/private-chat-check.mjs --plan --attempt-id retry-20261022 --date 2026-10-22
```

Os hashes do [procedimento inicial](2026-10-22-hosted-preflight.md) são históricos;
esta revisão tem novos hashes e não deve ser confundida com a versão executada:

| Ficheiro | SHA-256 revisto |
| --- | --- |
| `scripts/hosted/private-chat-check.mjs` | `BF643A235E909184B3D97C3091FF0EE4E3DEFE3EA577AA39903828DE760B986D` |
| `tests/hosted-plan.test.mjs` | `84CA7B8C31213A9D9FB3B2F829C420696199EA2D07E7C2FF49053BF0C2884695` |

## Validação e limites

16 testes focados passaram, incluindo os perfis/anti-replay, codec real, erro
transitório/negação/timeout, heartbeats e ausência de segredos no relatório.
Suite completa serial pela Coordenação: **131 aprovados, zero falhas ou
cancelamentos e dois excluídos por concorrência PGlite**, em 72,1 s. Inclui cinco
fixtures Chrome isoladas, com pedidos externos bloqueados. Lint sem avisos,
TypeScript e build sintético passaram, usando os equivalentes Node dos scripts
do projeto. Build não publicável. Links locais e `git diff --check` passaram.
Nenhuma Function mudou, pelo que não há novo type-check Deno.

Não provado nesta preparação: ligação alojada A/B/C, não entrega de broadcasts
diretos, Functions/Redis, SMTP, denúncias, bans ou retenção. Sem novas contas,
reposição da chave local, remoção da marca anterior, commit, push ou deploy.

## Limites horários distintos e decisão pendente

A espera de handshake do teste pode ser ajustada sem mudar a app. O horário
diário é validado por RPCs no servidor: mudar só a interface não o contorna.
Os testes locais isolados já controlam o relógio e verificam horários a qualquer
hora, mas não provam os serviços alojados.

Para a próxima execução real é preciso escolher uma nova janela/data, confirmar
credenciais locais e rever o perfil correspondente. Para testar os serviços
reais fora do horário, preparar um ambiente isolado com dados, Auth, Functions,
Realtime e Redis de teste, com horário próprio; isso não é uma autorização para
alterar o outro projeto ou criar recursos remotos/pagos. Não enfraquecer os
horários nem as permissões do projeto atual para ultrapassar o teste.
