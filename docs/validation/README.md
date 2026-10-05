# Validação: o que cada teste prova

## Níveis de evidência

| Verificação | Prova | Não prova |
| --- | --- | --- |
| Helpers/stores locais | Regressão da lógica de estado exercitada. | Browser completo, OTP ou WebSocket real. |
| Handlers com dependências injetadas | Fluxos/erros/idempotência nos cenários de teste. | Segredos, Lua real, JWT alojado ou entrega Realtime. |
| PGlite | SQL, papéis e contratos exercitados na base isolada. | Transações PostgreSQL concorrentes ou serviços Supabase. |
| CI PostgreSQL 17 | Gates e matchmaking concorrente no fixture local do job. | Auth/Realtime/Redis/SMTP alojados. |
| Type-check Deno | Tipos/imports da Functions. | Execução autenticada no ambiente publicado. |
| SQL/Redis alojado isolado | Cenários reais específicos com dados autorizados. | Fluxo completo entre browser, Functions e serviços. |
| Sessões reais em browsers | Cenários de integração efetivamente observados. | Casos não executados ou garantias universais de segurança. |

## Checklist de integração ainda necessária

Executar apenas em ambiente e com identidades autorizados. Ver
[estado](../project-status.md) e [operação](../operations/release.md).

- [ ] Preparar três sessões reais: participantes A/B e terceiro C.
- [ ] A/B subscrevem a sala privada e recebem envio autorizado do servidor.
- [ ] C não consegue subscrever/ler essa sala.
- [ ] Broadcast direto WS/REST de membro, terceiro e anónimo não chega a A/B;
      incluir controlo positivo servidor. Não exigir apenas HTTP 403: 202 não
      decide o teste de não entrega.
- [ ] Envio autenticado confirma ligação das Functions aos segredos Redis reais.
- [ ] Retry conserva ID e não duplica; testar falha de entrega e expiração real
      quando o objetivo exigir TTL, sem trocar uma simulação por espera real.
- [ ] Envios/denúncias simultâneos, dois denunciantes e falha de persistência:
      prova recuperável durante a janela disponível e sem sobrescrita vazia.
- [ ] Dois browsers: OTP, consentimento, refresh, Novo Chat, ambos os votos,
      separador fechado, reconexão, 22:48 e 22:50.
- [ ] Ban/eliminação numa sessão ativa; tentar operações com tokens anteriores;
      confirmar permissões e conservação da prova.
- [ ] Limpeza: limites de retenção e registos Cron, incluindo falhas observáveis.

As caixas não são preenchidas pelos testes locais. O
[registo de 2026-10-03](2026-10-03-hosted-services.md) contém provas parciais,
não conclusão destes cenários completos.

## Formato de evidência

```text
Data e ambiente/projeto:
Commit e versões publicadas:
Cenário e identidades sintéticas (sem tokens/dados pessoais):
Preparação e autoridade:
Resultado esperado:
Resultado observado:
Passou / falhou / inconclusivo:
Limitação:
Dados/chaves criados e confirmação da limpeza:
```

Não guardar credenciais, transcripts reais de utilizadores ou respostas que
revelem JWTs. Fixtures existentes na pasta antiga são material de referência;
não correr contra serviços reais só porque estão disponíveis.
