# U05 — clareza, teclado e identidade

## Objetivo e versão de partida

Resolver F09/F10/F11 da auditoria de interface, preservando U01–U04 já aceites.
Pasta principal Unider, branch `main`, HEAD
`07c8bb2d529b2968317442b7dc8e13a09b537908`. A árvore tinha alterações aceites e
documentação da Coordenação; não foi limpa nem substituída. Esta entrega não
inclui novas alterações Auth, stores, Functions, SQL, dependências ou lockfiles.

## Ficheiros e comportamento

- `index.html`, `public/favicon.svg`: idioma `pt-PT`, título Unider, SVG próprio.
  O ficheiro favicon existia na partida, mas ainda tinha o desenho do template.
- `src/pages/Login.tsx`: elimina a promessa de registo integral, esclarece buffer,
  conteúdo disponível e limpeza periódica; melhora contraste e espaçamento OTP
  em ecrãs pequenos. Destinatário, validação e operações U03 mantêm-se.
- `src/pages/Lobby.tsx`: nomes de Definições/Terminar sessão e do campo de
  sugestão; contraste. Não muda entradas, fila, cancelamento ou consentimento.
- `src/pages/Chat.tsx`: nome do campo Mensagem, cabeçalho adaptável e área de
  mensagens que pode encolher; contraste. Saídas, retries e histórico U02/U04
  mantêm-se. Não há anúncios automáticos do relógio.
- `src/components/modals/TermsModal.tsx`, `SettingsModal.tsx`: título/descrição,
  alertas, foco inicial e conteúdo de retenção coerente. Os termos não fecham
  com Escape ou clique no fundo, nem aceitam sem confirmação `true` de
  `accept_terms({ p_version: '1.1' })`. Definições fecha com Escape, foca Cancelar
  na confirmação e repõe o botão anterior ao cancelar. O cabeçalho mantém-se
  visível e o texto comprido tem scroll. A lógica U03 de eliminação/logout
  continua intacta.
- `src/components/modals/ModalFrame.tsx`, `src/hooks/useModalAccessibility.ts`:
  portal, `dialog`/`aria-modal`, Tab/Shift+Tab, isolamento `inert`, foco restaurado,
  elementos de fundo dinâmicos, modais sobrepostos e StrictMode. O isolamento
  preserva valores `inert` anteriores. Se um controlo focado desaparecer, o
  modal superior repõe foco útil.
- `src/index.css`: contorno de foco visível.
- `tests/accessibility-browser.test.cjs`: componentes reais e teclado em Chrome
  isolado a 320×568, operações de serviço simuladas, zero pedidos externos.
- `tests/chat-browser.test.cjs`: acrescenta verificação de nomes, ausência de
  overflow horizontal, campo dentro do viewport e relógio fora de regiões live.
  Mantém os testes U02/U04 e respetivos limites de tempo.
- `docs/architecture.md`, `docs/contracts.md` e este documento: registo U05.

O padrão de diálogo segue a orientação de
[WAI-ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): foco dentro
do diálogo, fundo inativo, navegação circular e reposição do foco. A exceção ao
Escape nos termos obrigatórios é um requisito explícito desta atribuição.

## Validação local

Executados os gates `npm test`, `npm run lint` e `npm run build`, usando Node
24.19.0 e uma CLI npm já disponível em modo de ferramenta, sem instalação.
Para ativar os testes de browser, `UNIDER_TEST_PLAYWRIGHT` aponta para o módulo
Playwright existente e `UNIDER_TEST_BROWSER` para o Chrome instalado.

- `npm test`: 73 testes, 72 aprovados, 0 falhas, 1 omitido. Inclui as quatro
  fixtures de browser e as regressões anteriores. O omitido é a concorrência
  PostgreSQL real: PGlite tem uma só ligação e não comprova essa propriedade.
- `npm run lint`: exit 0.
- `npm run build`: exit 0, incluindo TypeScript. Aviso de bundle acima de 500 kB
  (cerca de 560 kB); otimização de divisão do bundle não pertence a U05.
- `git diff --check`: exit 0.
- Inspeção visual do modal de eliminação em 320×568: texto com scroll, cabeçalho
  e fecho visíveis, Cancelar/Sim, apagar acessíveis; sem overflow horizontal.

O teste de teclado cobre abertura, foco útil, Tab/Shift+Tab, fundo não focável,
restauração, modais sobrepostos, Escape permitido/proibido, clique no fundo,
recusa de consentimento, versão `1.1`, gate real do Lobby sem criar intenção de
fila, nomes acessíveis, idioma, título e favicon servido localmente. A simulação
de eliminação cobre também foco no passo em que falta confirmar a saída.

Uma execução intermédia do novo teste falhou ao voltar de Login para Lobby:
a fixture não atualizava o perfil após aceitar termos, pelo que o produto
corretamente voltou a exigir consentimento. A fixture passou a representar a
persistência confirmada; não foi aumentado o timeout nem contornado o modal.
O timeout de 5 segundos do Lobby observado anteriormente em U04 mantém-se
registado na validação U04; não foi removido nem disfarçado por U05.

## Limites, riscos e entrega

Esta validação não comprova serviços alojados, envio de email, Cron real ou
leitores de ecrã reais. O contrato local descreve limpeza periódica de denúncias
com mais de 30 dias; falhas operacionais podem atrasá-la. O buffer recuperado
continua parcial e as mensagens conhecidas podem existir no separador.
Não foram executadas alterações remotas, deploys, compras, migrações ou contas
de teste. Deno não se aplica a esta alteração exclusivamente de interface.

Não foi criado commit nem feito push. O diff está disponível na árvore local e
inclui também U01–U04 preservadas; a lista acima delimita U05. A claim U05 é
libertada após entrega e a área aguarda revisão da Coordenação, sem iniciar U06.
