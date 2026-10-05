# Arquitetura e mapa do código

## O que é a aplicação

O Unider é uma SPA para conversas efémeras entre estudantes com email
`@student.uc.pt`. React/TypeScript desenha a interface; Supabase fornece Auth,
PostgreSQL, RPCs, Realtime e Edge Functions; Upstash Redis conserva o buffer
temporário. Cloudflare Pages serve o frontend compilado em `dist/`.

Uma denúncia pode persistir o conteúdo disponível em PostgreSQL. “Efémero” não
significa que os textos nunca existam no browser ou em armazenamento temporário.
A especificação inicial previa PWA, mas este repositório ainda não inclui um
manifesto/service worker que demonstre essa funcionalidade completa.

## Onde está cada responsabilidade

| Caminho | Responsabilidade |
| --- | --- |
| `src/main.tsx` | Monta React e importa o estilo global. |
| `src/App.tsx` | Rotas, guardas de sessão e observação do estado Auth. |
| `src/pages/Login.tsx` | Email institucional, pedido OTP e verificação do código. |
| `src/pages/Lobby.tsx` | Contagem, sugestões, termos, espera e entrada no chat. |
| `src/pages/Chat.tsx` | Receção privada, envio, retry, extensão, denúncia e saída. |
| `src/components/modals/` | Termos e definições; não são páginas com rota própria. |
| `src/hooks/useChatSession.ts` | Polling RPC, relógio da sala e recuperação de estado. |
| `src/hooks/useTimeSync.ts` | Atualiza o relógio local usado pela apresentação do lobby. |
| `src/lib/chatSession.ts` | Tipo `RoomState` e cálculo puro da fase/tempo restante. |
| `src/lib/supabase.ts` | Cliente público Supabase configurado pelas variáveis Vite. |
| `src/store/authStore.ts` | Sessão, identidade e saída da conta. |
| `src/store/chatStore.ts` | Sala, mensagens e contexto por utilizador em `sessionStorage`. |
| `src/store/appStore.ts`, `src/utils/time.ts` | Modos/contagens de apresentação em Lisboa. |
| `supabase/migrations/` | Evolução do schema, RPCs, políticas e limpeza. |
| `supabase/functions/_shared/chat.ts` | Auth, autorização, Redis, broadcast e lock comuns. |
| `supabase/functions/*/handler.ts` | Operação de negócio testável por injeção de dependências. |
| `supabase/functions/*/index.ts` | Entrada Deno da Function. |
| `tests/` | Regressões de estado, handlers e base de dados isolada. |
| `tests/documentation.test.cjs` | Verifica links locais dos guias e instruções. |
| `.github/workflows/review-regressions.yml` | Gates com PostgreSQL 17 e type-check Deno. |
| `public/_redirects` | Fallback de rotas da SPA para `index.html`. |

## Fluxos essenciais

### Login e consentimento

`Login` pede/verifica OTP em Supabase Auth. `App` acompanha a sessão, e
`authStore` liga o contexto de chat ao utilizador. `Lobby` lê a versão dos termos;
`TermsModal` chama `accept_terms('1.1')`. O servidor exige elegibilidade nas
operações sensíveis: sessão visual não substitui autorização.

### Emparelhamento e sala

Ao entrar, `chatStore.isQueueing` ativa `useChatSession`. O hook consulta
`find_or_join_match` até receber sala e peer; depois consulta `get_room_state`.
Os RPCs mantêm leases/heartbeats e devolvem hora/prazos do servidor. O frontend
calcula a apresentação, mas não altera esses prazos localmente.

O Presence `campus-queue` no lobby é auxiliar e atualmente é criado sem
`private: true`. Não é a fonte de verdade do emparelhamento. A sua compatibilidade
com public channels desativados é uma pendência de validação, não algo garantido.

### Mensagem

`Chat` subscreve `room:<uuid>` privado e chama `send-message` por HTTP. A Function
verifica Auth/membership, obtém lock, acrescenta ao Redis com deduplicação Lua e
publica o broadcast privado pelo servidor. O browser adiciona o resultado
confirmado e deduplica a receção pelo ID. Num retry do mesmo conteúdo mantém o ID.

### Denúncia

`Chat` chama `report-room` apenas com o ID da sala. A Function usa o mesmo lock,
congela a sala via autorização, lê o buffer e chama `persist_room_report`.
O transcript vem do servidor, não de uma lista que o browser possa falsificar.
Falha de persistência devolve erro e permite retry; o buffer não é apagado nessa
operação. O TTL pode expirar, pelo que não há garantia de histórico completo.

## Limites de confiança

Interface e `sessionStorage` são estado de apresentação e podem estar desatualizados.
Auth valida identidade; RPCs validam elegibilidade, membership e prazos;
Functions controlam efeitos no Redis e Realtime. Segredos só existem no servidor.
Ver [contratos](contracts.md) para interfaces e [validação](validation/README.md)
para o que ainda precisa de ser provado em sessões reais.
