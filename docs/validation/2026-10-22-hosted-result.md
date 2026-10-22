# Tentativa alojada A/B/C — resultado de 22/10/2026

## Resultado: inconclusivo; tentativa única concluída e limpa

Execução autorizada no projeto `ymzcsoyylrpkdflnlvkg`, com o procedimento
preparado e revisto em [preflight](2026-10-22-hosted-preflight.md).
Base `b7a62bc1107d48224d7d34def130e90d96edb479`, branch
`fix/unider-functional-recovery`; alterações locais anteriores preservadas.
Hashes do runner e dos testes coincidem com os valores revistos.

Execução `57402473-8293-499f-97b6-9eec1d021ddf`. O servidor confirmou
22/10/2026 às **22:30:50 Europe/Lisbon**. A verificação inicial de ausência de
atividade real passou, assim como a marca atómica contra repetição.

Comando executado uma vez, na raiz, com a chave carregada apenas no processo Node:

```powershell
& 'C:/Users/joaoa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' --env-file=.env.hosted-test.local scripts/hosted/private-chat-check.mjs --execute
```

## O que ficou demonstrado

- Criação de exatamente três contas sintéticas com confirmação administrativa,
  sem emails, nos parâmetros autorizados.
- Login por password dos três clientes comuns, separado do cliente administrativo.
- Emparelhamento real apenas entre os fixtures A/B, sem interlocutor externo.
- Revogação das três sessões e eliminação das três contas, revalidadas por
  ID/email/marcador. Ausência das contas confirmada pelo procedimento.

## Ponto de paragem e limites

A primeira subscrição privada, do participante A, não foi confirmada.
Resultado registado: `subscription_not_confirmed`, estatuto `inconclusive`;
processo terminou com código 1 após o `finally` de limpeza.
O relatório não conserva detalhe suficiente para distinguir timeout, transporte
ou outra falha de subscrição. Não demonstra uma causa específica nem uma falha
de autorização da aplicação.

Não chegaram a ser executadas as subscrições B/C, o envio servidor, a recuperação
de histórico, a deduplicação ou os controlos de não entrega de broadcasts diretos.
Logo, **canais privados e caminho Functions/Redis continuam por validar**.
Não foram criadas denúncias, injetadas falhas ou testados SMTP, bans e retenção.
Não foi repetida a tentativa nem alterado o procedimento para contornar a paragem.

## Limpeza, artefactos e pendência

Relatório sanitizado local em
`node_modules/.cache/hosted-private-chat/57402473-8293-499f-97b6-9eec1d021ddf.json`:
os três fixtures têm `revoked: confirmed`, `deleted: true` e
`manualCleanupRequired: false`. Canais removidos e clientes desligados pelo
`finally`. Nenhuma limpeza manual de conta ficou pendente.

Após verificar esse resultado, removida apenas a cópia local ignorada
`.env.hosted-test.local`, sem imprimir o conteúdo. A chave na plataforma não foi
revogada nem alterada. A marca
`node_modules/.cache/hosted-private-chat/ymzcsoyylrpkdflnlvkg-2026-10-22.attempt.json`
foi conservada: a autorização de três contas desta tentativa está consumida.

Sem alteração de código, configurações, inscrições, horários, políticas,
migrations, Functions ou contas existentes. Sem commit/push/deploy.
Documentação verificada com `node --test tests/documentation.test.cjs` e
`git diff --check`; gates runtime não repetidos porque o código não mudou.

Pendência: investigar a falta de confirmação da subscrição, distinguindo
cliente/rede de resposta Realtime. Qualquer nova tentativa com contas temporárias
exige nova autorização e credenciais; não reagendar nem recriar automaticamente.
