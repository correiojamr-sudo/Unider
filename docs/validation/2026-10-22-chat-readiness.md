# Revisão local do chat — 22/10/2026

## Âmbito e versão

Continuação local autorizada enquanto se aguarda a tentativa alojada das 22:30.
Base `b7a62bc1107d48224d7d34def130e90d96edb479`, branch existente
`fix/unider-functional-recovery`. Alterações locais anteriores preservadas.
Uma área fez revisão apenas de leitura; a Coordenação reviu a conclusão e os
testes. Não houve escritores concorrentes.

Revistos `Chat`, `useChatSession`, `useChatHistory`, helpers e store do chat:
trocas de sala/identidade, respostas tardias, retry de envio, cancelamento,
saída, extensão e recuperação/fusão do histórico. Não foi demonstrado um novo
defeito prioritário neste âmbito. Isto não significa ausência universal de erros.

O candidato de recuperação após rejeição de `realtime.setAuth()` foi descartado
como achado: o SDK instalado captura a falha do callback Auth e usa o token em
cache. Uma rejeição injetada não demonstraria essa falha no percurso real.
Não se acrescentou código de recuperação especulativo.

Corrigida apenas a indicação obsoleta em `docs/contracts.md` de que a migration
2.1 ainda não tinha sido aplicada. O documento aponta para a publicação de 22/10
e distingue os timestamps local e remoto; não altera SQL nem contratos runtime.

## Verificação

Executado com Node instalado, Playwright e Chrome locais, em série:

```sh
node --test --test-concurrency=1 tests/chat-state.test.cjs tests/chat-recovery.test.cjs tests/chat-history.test.cjs tests/chat-browser.test.cjs tests/documentation.test.cjs
```

Resultado: **35 aprovados, zero falhas/cancelamentos/exclusões**. Inclui o
componente Chat/Lobby e hooks/stores reais no Chrome 155, com serviço simulado
e pedidos externos bloqueados. Verifica reconexão/histórico, IDs por remetente,
retry, saídas, denúncia, prazos e respostas de contexto anterior.

Sem alteração de código nesta revisão: não repetidos lint/build nem suite
completa já executados na preparação anterior. `git diff --check` sem erros.

## Limites e preservação da tentativa alojada

Nenhuma mudança remota, conta criada, deploy, commit ou push. Sem alteração de
Functions, migrations, credenciais, inscrições ou agendamento. Os SHA-256 do
runner `scripts/hosted/private-chat-check.mjs` e de `tests/hosted-plan.test.mjs`
continuam iguais aos do [procedimento revisto](2026-10-22-hosted-preflight.md).

Os testes isolados não provam Auth, canais privados, Redis ou entrega alojados.
A tentativa real das 22:30 continua necessária e separada desta revisão.
