# Guia de leitura do Aquecimento

Este índice é o ponto de entrada para entender o código e trabalhar sem perder
os contratos entre interface, servidor e serviços externos.

## Por onde começar

- [Preparação jurídica e de privacidade](legal-readiness.md): documentos 2.0,
  maioridade declarada, contacto e pendências de publicação.

- [README principal](../README.md): objetivo, instalação e comandos.
- [Arquitetura](architecture.md): responsabilidades dos ficheiros e fluxos.
- [Contratos](contracts.md): RPCs, Functions, canais e limites atuais.
- [Desenvolvimento](development.md): execução local e verificações.
- [Estado e pendências](project-status.md): o que foi registado e o que falta.
- [Revisão complementar de 08/10](validation/2026-10-08-followup-review.md):
  prazo de denúncia corrigido localmente e restos do template de baixa prioridade.
- [Revisão A01–A05](validation/2026-10-05-open-findings.md): evidência original
  e critérios de aceitação, com ligação às correções posteriores.
- [Correções A01–A05 aceites localmente](validation/2026-10-08-findings-fixes.md):
  revisão, testes finais e limites de publicação/validação alojada.
- [Auditoria funcional e correções](validation/2026-10-05-site-audit.md): problemas
  identificados em 05/10, evidência e sequência de tarefas por área.
- [Correções U01–U06 e integração pendente](validation/2026-10-05-integration-readiness.md):
  resultados locais, leitura parcial dos serviços e autorizações para publicar/testar.
- [Validação](validation/README.md): níveis de evidência e cenários de aceitação.
- [Operação e lançamento](operations/release.md): configuração e ordem coordenada.
- [Coordenação](coordination.md): tarefas, revisão e passagem à área seguinte.
- [Mensagens das áreas](agent-prompts.md): textos iniciais para os três chats.
- [AGENTS.md](../AGENTS.md): instruções obrigatórias para agentes.
- [Verificação desta organização](validation/2026-10-05-repository-organization.md):
  alterações, preservação e gates executados.

## Referências históricas

- [Correções da revisão](review-fixes.md): contratos e testes introduzidos no PR #6.
- [Validação alojada de 2026-10-03](validation/2026-10-03-hosted-services.md):
  evidência anterior, com limites explícitos; não é uma verificação de hoje.
- [Especificação original](reference/original-specification.md): proposta inicial,
  preservada para contexto. Não executar o SQL nem seguir os fluxos antigos.

## Atualização da documentação

Quando uma alteração modifica um contrato ou comportamento, atualizar o guia
correspondente na mesma entrega. Não duplicar valores e regras sem indicar a
fonte no código. Uma checklist só passa a concluída com evidência identificável.
Estado dos serviços tem sempre data e ambiente; documentação não é monitorização.
