# Auditoria funcional e sequência de correções — 2026-10-05

Base: `main`, commit `07c8bb2d529b2968317442b7dc8e13a09b537908`.
Página observada: `https://unider.pages.dev/login`, sem sessão autenticada.
O proprietário pediu identificação e delegação das correções, uma área de cada vez.

## Evidência e limites

- O browser confirmou título `vite-project`, idioma HTML `en`, referência a
  `/favicon.svg` e a promessa de preservação do «registo integral» no login.
- Foi inspecionado o código de login, lobby, chat, modais, stores, relógio,
  RPCs e handlers. Os problemas abaixo distinguem execução de análise estática.
- Execução das funções atuais com relógio fixo: às 22:35 de Lisboa,
  `getSecondsUntil('22:30:00')` apresenta `23:55:00`; às 22:49,
  `getModeFromTime` devolve `ACTIVE`, embora SQL recuse novos pares desde 22:48.
- Testes existentes: 24 passaram, 1 excluído (concorrência PostgreSQL).
  Comando usado: `node --test --test-isolation=none tests/*.test.cjs tests/*.test.mjs`.
  O comando com isolamento padrão falhou antes de executar os testes com
  `spawn EPERM` neste ambiente. A alternativa não valida o isolamento padrão.
- Não foram iniciadas sessões, enviados emails, criadas contas ou alterados
  serviços. Login alojado, canais privados, Redis e fluxos autenticados continuam
  por validar. Não se infere configuração atual a partir do registo de 03/10.
- Esta é uma primeira auditoria funcional, não uma certificação exaustiva de
  segurança. Não foram alterados ficheiros da aplicação nesta auditoria.

## Problemas confirmados

| ID | Prioridade | Problema e efeito | Evidência |
| --- | --- | --- | --- |
| F01 | P1 | Refresh durante a pré-fila perde a entrada automática: o lobby reinicia `inQueue=false`, apesar de `chatStore.isQueueing` persistir. A navegação às 22:30 depende exclusivamente de `inQueue`. | Análise de `Lobby.tsx`, `chatStore.ts` e `useTimeSync.ts`. |
| F02 | P1 | Entre 22:48 e 22:50 o lobby oferece «Entrar na Fila»; o servidor recusa novos pares. | Execução de `getModeFromTime` e comparação com `find_or_join_match`. |
| F03 | P2 | Durante a sessão a contagem aponta para as 22:30 do dia seguinte; o texto também diz que as conversas começam «em breve». Durante o dia o título anuncia 22:30 mas a contagem termina às 22:28. | Reprodução 22:35 → `23:55:00`; JSX do lobby. |
| F04 | P2 | A pré-fila cria Presence público `campus-queue`, sem consumidor dos eventos nem tratamento de falha. A indicação «Estás na fila» não depende de confirmação desse canal. É incompatível com a configuração privada registada em 03/10; a configuração alojada atual não foi consultada. | `Lobby.tsx`; [contratos](../contracts.md); [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization). |
| F05 | P1 | Com `roomId` existente e fase `loading`/`active`, o chat não oferece saída. Se `get_room_state` recusar uma sala guardada (por exemplo, já limpa no dia seguinte), o polling repete indefinidamente e não existe recuperação visual para o lobby. | Ramos de renderização de `Chat.tsx` e erro em `useChatSession.ts`; limpeza SQL após um dia. Cenário autenticado ainda não executado. |
| F06 | P2 | Qualquer falha de denúncia diz «A conversa foi suspensa», mesmo que o pedido não tenha chegado ao servidor ou tenha falhado na autenticação/lock antes de congelar a sala. | `Chat.tsx` catch de `report`; ordem em `report-room/handler.ts`. |
| F07 | P2 | Login recusa domínio institucional em maiúsculas, embora o trigger normalize com `LOWER`. Erros de Auth são apresentados diretamente, e a etapa OTP não oferece reenvio explícito nem identifica o email destinatário. | `Login.tsx` e `0001_initial_schema.sql`. Não foi enviado OTP. |
| F08 | P2 | A sugestão de quebra-gelo falha silenciosamente quando o INSERT devolve erro. O texto fica no campo mas não há aviso nem indicação de retry. | `Lobby.tsx`, `handleSuggest`. |
| F09 | P2 | O login promete guardar o «registo integral» em denúncias; os termos e o servidor apenas conservam as mensagens disponíveis no buffer temporário. | Texto observado no site, `TermsModal.tsx` e `report-room/handler.ts`. |
| F10 | P2 | Botões só com ícone (definições, logout, fechar, enviar) não têm nome acessível; modais não definem semântica de diálogo nem gestão de foco. | JSX de lobby, chat e modais. Verificação com leitor de ecrã pendente. |
| F11 | P3 | Identidade de template: título `vite-project`, documento em inglês e favicon referenciado sem ficheiro correspondente em `public/`. | Browser, `index.html` e inventário local. |
| F12 | P2 | Build sem configuração Supabase continua a produzir aplicação que tenta usar `localhost:54321` e uma chave fictícia. Um build bem-sucedido pode resultar num login inutilizável. | `src/lib/supabase.ts`; é falha de tratamento de configuração, não prova de que o Pages atual esteja mal configurado. |

## Riscos a reproduzir antes de escolher implementação

- **R01 — mensagens durante reconexão:** a receção é só por broadcast; o cliente
  não pede mensagens em falta ao regressar. Um peer pode perder mensagens durante
  refresh/desligação enquanto o remetente recebe sucesso. Existe buffer servidor,
  mas não endpoint de recuperação. Demonstrar a perda com transporte controlado
  e decidir o contrato de recuperação antes de introduzir nova API.
- **R02 — pedidos assíncronos antigos:** login/termos/definições não protegem todos
  os caminhos com `finally` e cancelamento; `App` não trata rejeição de
  `getSession`. Reproduzir exceções/respostas atrasadas e impacto antes de corrigir.
- **R03 — relógio do dispositivo:** o lobby escolhe horários com o relógio local;
  só a sala recebe hora do servidor. Avaliar o comportamento com desvio de relógio
  sem permitir que o cliente conceda autorização.
- **R04 — integração alojada:** SMTP/template OTP, inscrições controladas, três
  sessões, WS/REST privados, Redis/Functions, bans, eliminação e Cron precisam de
  evidência atual. Ausência de teste não equivale a defeito confirmado.

## Ordem de execução e critérios de aceitação

Só a primeira tarefa será enviada agora. As seguintes dependem de revisão e
aceitação da anterior e recebem base/diff atualizados na atribuição. Esta lista
é backlog de produto, não substitui as claims nem o estado dos chats.

### U01 — Fila e horários coerentes (Produto e Interface)

Corrigir F01–F04 e F08, preservando os RPCs e os limites do servidor.

- Usar uma fonte coerente para o estado da pré-fila, incluindo refresh e retorno
  ao lobby. Permitir cancelar a espera; não afirmar emparelhamento antes do RPC.
- Distinguir pré-fila, novos pares permitidos e período final sem novos pares.
  Não oferecer nova entrada a partir das 22:48. Não interromper uma sala válida
  que pode continuar até às 22:50.
- Contagem e texto devem anunciar o mesmo evento em cada fase; nenhuma contagem
  para o dia seguinte enquanto a sessão atual está em curso.
- Remover o Presence público sem uso; não reabrir canais públicos nem criar
  políticas para o manter. Emparelhamento continua exclusivamente por RPC.
- Sugestão recusada mostra erro recuperável e conserva o texto; sucesso só após
  confirmação. Não adicionar dependências para estas correções.
- Testes de comportamento: 22:27:59, 22:28, 22:29:59, 22:30, 22:47:59, 22:48,
  22:49:59 e 22:50; pré-fila hidratada/refresh, cancelamento, falha de sugestão.
  Incluir datas de inverno/verão de Lisboa. Gates locais exigidos pelo AGENTS.
- Caminhos possíveis: `src/pages/Lobby.tsx`, `src/store/appStore.ts`,
  `src/store/chatStore.ts`, `src/utils/time.ts`, `src/hooks/useTimeSync.ts`,
  helpers específicos novos em `src/lib/`, testes específicos e documentação
  de arquitetura/contratos. Não alterar `Chat.tsx`, Auth, SQL ou Functions nesta tarefa.

### U02 — Saída e recuperação de conversa (Produto e Interface)

Depois de U01 aceite, corrigir F05/F06. Acrescentar saída acessível em todas as
fases, recuperar contexto inválido sem permitir operações sobre sala recusada
e não afirmar suspensão sem confirmação. Distinguir erro transitório de sala
definitivamente indisponível. Preservar ID de retry, consentimento e prova.
Testar sala inexistente/expirada, rede indisponível, saída recusada e falhas de
denúncia antes/depois do congelamento. Caminhos: Chat, hook de sessão, store,
helpers/testes e docs relevantes; eventual novo contrato exige atribuição ampliada.

### U03 — Login e recuperação de sessão (Backend e Segurança, âmbito transversal)

Depois de U02 aceite, corrigir F07 e reproduzir R02. Normalizar o email antes de
validar/enviar, apresentar erros PT-PT úteis, permitir reenvio respeitando limites,
mostrar destinatário e evitar respostas antigas sobre novo pedido. A configuração
alojada de OTP deve ser lida antes de presumir tamanho/template. Testar falha,
retry, alteração de email e sessão inicial. Caminhos: Login, App, authStore,
helpers/testes/docs relevantes. Não abrir inscrições nem configurar SMTP por
efeito desta tarefa; testes locais não certificam entrega real de email.

### U04 — Receção após reconexão (Backend e Segurança, âmbito transversal)

Depois de U03 aceite, reproduzir R01 e propor/corrigir a recuperação com base na
evidência. Se for necessária API adicional, delimitar primeiro contrato,
membership, TTL e impacto na privacidade. Não conceder leitura direta do Redis
ao browser nem publicação cliente. Aceitação: mensagens aceites durante uma
reconexão curta recuperadas sem duplicação nem acesso de terceiros; expiradas
não reaparecem. SQL novo só em migration nova e sem aplicação remota implícita.

### U05 — Informação e acessibilidade (Produto e Interface)

Depois de U04 revista, corrigir F09–F11: conteúdo coerente com retenção técnica,
identidade UNIDER/pt-PT/favicon existente, nomes acessíveis, foco e teclado dos
modais, mensagens de erro anunciadas. Testar teclado e ecrã pequeno. Não inventar
obrigações legais nem alterar prazos de retenção nesta tarefa.

### U06 — Configuração e validação alojada (Infraestrutura e Validação)

Depois das correções locais aceites, corrigir F12 e rever R03/R04. Configuração
ausente deve produzir diagnóstico claro e não um login aparentemente funcional.
Rever CI/gates e preparar matriz de integração atual com três sessões. Ler
configurações e versões antes de propor alterações; dados, contas, emails,
deploys e configurações remotas continuam sujeitos a autorização específica.
Entregar resultados reais e pendências, nunca marcar mocks como testes alojados.

## Passagem e versão

Cada área recebe uma única tarefa, caminho/base permitidos, critérios e condição
de paragem. Entrega o diff na pasta partilhada, sem push, merge ou deploy.
A Coordenação revê o diff e a evidência antes de atribuir a seguinte. O backlog
pode ser reordenado se aparecer um defeito mais grave com prova concreta.

## Resultado da sequência em 05/10

U01–U06 foram executadas em sequência e aceites pela Coordenação na árvore local
sobre a base acima. O catálogo deste documento descreve a auditoria inicial;
não significa que os defeitos corrigidos ainda estejam presentes no diff atual.
R01–R03 foram reproduzidos/corrigidos localmente; R04 continua dependente de
validação e autoridade nos serviços reais. Não houve commit, push ou deploy.

O [estado atual](../project-status.md) identifica as entregas aceites e os gates
finais. A [matriz de integração](2026-10-05-integration-readiness.md) separa
evidência local, leitura alojada parcial e testes ainda por autorizar. O sucesso
local não certifica o site publicado nem a configuração atual dos serviços.
