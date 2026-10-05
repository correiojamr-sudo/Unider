# Instruções dos agentes — Unider

## Objetivo e leitura inicial

Implementar tarefas delimitadas no Unider, preservar o código integrado e
entregar alterações verificáveis. Esta pasta é o repositório partilhado; uma
mensagem noutro chat não substitui a leitura dos ficheiros atuais.

Antes de trabalhar, ler:

1. Este `AGENTS.md` e eventuais instruções mais específicas no caminho alterado.
2. `README.md` e `docs/README.md`.
3. `docs/coordination.md` e `docs/project-status.md`.
4. Os documentos de arquitetura, contratos, desenvolvimento e validação
   relevantes para a tarefa, e o próprio código.

Usar as skills aplicáveis. Para Supabase, carregar a skill Supabase; para Pages,
a skill Cloudflare. Ler a documentação atual antes de mudar contratos externos.
Não implementar um pedido apenas com base na especificação histórica.

## Coordenação e passagem de trabalho

- O chat designado pelo proprietário coordena o objetivo atual, quando invocado.
  Não é um processo em segundo plano e não recebe conclusões automaticamente.
- Existem três áreas: Produto e Interface, Backend e Segurança, e Infraestrutura
  e Validação. Cada área executa uma tarefa completa, incluindo testes e docs.
- Apenas uma área altera ficheiros de cada vez. A seguinte começa depois da
  revisão e aceitação explícita da Coordenação.
- Sem tarefa concreta, não editar: confirmar o âmbito e aguardar.
- A atribuição deve identificar objetivo, versão de partida, caminhos permitidos,
  dependências, critérios de aceitação e autoridade para ações externas.
- Trabalhar na mesma pasta principal e branch indicadas. Não criar ou mudar
  branches/worktrees durante a execução coordenada. A Coordenação estabelece a
  branch antes de começar uma sequência de tarefas.
- As áreas são especialidades, não propriedade permanente de diretórios.
  Uma alteração transversal exige atribuição que inclua todos os caminhos.

O quadro opcional da skill `codex-coordinator` só existe se houver um marcador
válido em `.codex/coordination/project.yaml`. Não o inventar nem inferir IDs.
Quando estiver habilitado, ler primeiro o marcador na pasta principal, carregar
a skill, consultar as claims e publicar apenas a claim deste agente com o UUID
nativo exato. Sem identidade segura, manter trabalho numa única tarefa; não
iniciar escritas paralelas. Não guardar prompts ou transcrições nesse quadro.

## Trabalho local e Git

- Confirmar pasta, `git status --short`, branch e `git rev-parse HEAD` antes de
  editar. Comunicar divergência em relação à versão atribuída.
- Preservar ficheiros modificados, staged e untracked. Não assumir que são lixo.
- Usar alterações pequenas e reler ficheiros partilhados imediatamente antes de
  editar. Não copiar blocos de código de outro chat sobre o repositório.
- Não usar `git add .`, `git add -A`, force push, reset destrutivo, limpeza ampla
  ou stash para esconder alterações. Não executar pull/rebase/merge enquanto
  houver outro escritor ativo.
- Se houver autorização para commit, incluir apenas caminhos explicitamente
  revistos; inspecionar também o índice para excluir alterações de terceiros.
- Push, merge e publicação exigem autorização do proprietário ou da atribuição
  que se apoie nela. A Coordenação não pode inventar autoridade externa.
- Não mudar dependências ou lockfiles por conveniência numa tarefa documental.
  Serializar comandos que regeneram saídas partilhadas e rever o resultado.

## Contratos que não podem ser enfraquecidos

- O frontend é uma SPA React/Vite publicada em Cloudflare Pages. Não migrar para
  Workers como parte de uma arrumação ou correção não relacionada.
- Autorizações, identidade e prazos sensíveis são verificados no servidor.
  O relógio e o estado do browser não concedem acesso.
- Salas `room:<uuid>` são privadas. Clientes recebem mensagens, mas não podem
  publicar broadcasts diretamente nem inserir denúncias diretamente na tabela.
- Identidade da mensagem/denúncia vem do JWT verificado, nunca de um ID no JSON
  que o cliente escolheu. Não conceder permissões cliente aos RPCs service-only.
- Preservar consentimento, membership, bans, idempotência, fencing do lock e
  recuperação após falha. Não remover prova de denúncia num retry.
- Não expor `service_role`, tokens Redis, credenciais SMTP, JWTs ou passwords em
  código cliente, docs, logs, relatórios ou mensagens.
- Não editar migrations aplicadas nem executar SQL da especificação histórica.
  Novas alterações de schema precisam de migration nova, testes e plano de operação.
- O projeto pré-abertura tem um bootstrap consolidado registado em 2026-10-03.
  Reconciliar histórico antes de qualquer `supabase db push`; não reaplicar os
  três ficheiros históricos nesse projeto. Ver `docs/operations/release.md`.
- Não alterar o outro projeto Supabase nem abrir inscrições para facilitar testes.
  Deploy, dados, contas de teste, segredos, compras e configurações remotas exigem
  autorização específica. Capacidade técnica não é autorização.

## Verificação e entrega

Executar os testes relevantes e, para alterações de código, os gates locais
`npm test`, `npm run lint` e `npm run build`. Para Functions, executar também
o type-check Deno descrito em `docs/development.md`. Se algo não puder correr,
indicar exatamente o que falta; não o marcar como aprovado.

PGlite não prova concorrência PostgreSQL. Mocks não provam Auth, Realtime,
Upstash, SMTP ou Cron alojados. Testes reais exigem ambiente e dados autorizados.
Nunca apontar o harness automático a Supabase ou a dados da aplicação.

A entrega deve conter: objetivo, versão de partida, ficheiros alterados, resumo
do comportamento, comandos/testes e resultados reais, limitações, riscos,
mudanças remotas realizadas (ou nenhuma), e commit/diff disponível. Parar após
a entrega e aguardar a revisão; não começar a próxima tarefa autonomamente.

## Comunicação com o proprietário

- Usar português de Portugal, direto e acessível. Sem parágrafos de aquecimento.
- Não começar por concordar: apontar primeiro a lacuna, risco ou decisão relevante.
- Antes de afirmações, distinguir `[Certain]` (evidência direta), `[Likely]`
  (inferência forte) e `[Guessing]` (suposição). Declarar quando predomina suposição.
- Se discordar, explicar razão, alternativa e risco específico. Não abandonar
  uma conclusão fundamentada sem informação nova.
- Evitar elogios automáticos como “Great Question”, “You're absolutely right”,
  “That makes a lot of sense”, “Absolutely” e “Definitely”.
- Dar atualizações curtas durante trabalho prolongado e separar conclusão,
  validação parcial e bloqueios. Não prometer coordenação automática entre chats.
