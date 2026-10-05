# Coordenação e integração

## Modelo de trabalho

O proprietário traz pedidos ao chat de Coordenação. A Coordenação transforma
cada pedido numa tarefa delimitada e atribui-a a uma área. Só há um escritor de
código/documentação de cada vez. A revisão e aceitação precedem a tarefa seguinte.

Todos usam o mesmo projeto local, a mesma pasta principal e a mesma branch da
sequência. Não transportar código entre chats por copiar/colar nem trabalhar
em snapshots independentes. Abrir três chats não autoriza três implementações
simultâneas. A disponibilidade do coordenador é a pedido, sem acompanhamento
automático ou promessa de que a conclusão de uma área o acorda.

## Áreas

| Área | Resultado típico | Caminhos habituais, não autorização automática |
| --- | --- | --- |
| Coordenação e Integração | Prioridades, atribuição, revisão e versão aceite. | Docs, diffs, gates e operações especificamente autorizadas. |
| Produto e Interface | Fluxo utilizável, acessível e testado. | `src/pages/`, `src/components/`, hooks/stores/helpers frontend, estilos e testes relevantes. |
| Backend e Segurança | Contrato servidor correto, com testes de falha/permissões. | `supabase/`, contratos e regressões backend. |
| Infraestrutura e Validação | Ambiente/configuração e evidência de funcionamento completo. | `.github/`, configuração Pages, guias de operação/validação e testes de integração. |

Uma tarefa inclui investigação, implementação, testes e documentação. Não abrir
mais uma área apenas para um comando de teste ou uma revisão pequena. Fronteiras
transversais são resolvidas no âmbito da atribuição, não por alterações surpresa.

## Atribuição mínima

```text
Objetivo:
Área responsável:
Pasta principal e branch:
Commit de partida e estado local esperado:
Caminhos permitidos:
Dependências/contratos a preservar:
Critérios de aceitação:
Verificação exigida:
Ações externas autorizadas (ou nenhuma):
Condição de entrega e paragem:
```

Sem estes elementos, pedir apenas a informação que impede trabalho seguro.
Reabrir o ficheiro atual antes de editar e comunicar divergência da base.

## Passagem

1. Coordenação confirma base e deixa o âmbito claro.
2. A área executa a tarefa completa, preservando alterações de terceiros.
3. Entrega diff/ficheiros, testes reais, limitações e alterações remotas.
4. Coordenação revê comportamento e contratos, e verifica os gates pertinentes.
5. Aceita uma versão identificável ou devolve correções à mesma área.
6. A próxima área começa apenas sobre a versão aceite.

Commits, pushes ou PRs seguem a autorização e política da tarefa. Não há merge
automático nem deploy implícito por concluir testes. Mudar `main` pode publicar
Pages; essa operação é uma decisão separada.

## Estado local da ferramenta

`AGENTS.md` e estes documentos são a orientação partilhada, não um bloqueio de
ficheiros. A instalação da skill `codex-coordinator` não habilita um quadro por
si só. Um quadro habilitado exige marcador schema 2 com identidade de projeto
correta e claims com UUIDs nativos exatos. Sem isso, manter a sequência numa única
tarefa ativa. Não criar IDs fictícios ou um quadro manual substituto.

O quadro, quando existir, contém só fronteiras ativas; não prompts, transcrições
ou um diário paralelo. Pendências de produto ficam em `project-status.md` ou no
backlog que o proprietário escolher. Ver instruções na skill antes de o habilitar.
