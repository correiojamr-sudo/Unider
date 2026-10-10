# Aquecimento

Projeto independente, sem afiliação à Universidade de Coimbra, anteriormente
chamado Unider. Conversas temporárias para maiores de 18 anos com email
`@student.uc.pt`, numa janela
diária em Lisboa. Frontend React/TypeScript com Vite e Tailwind, servido por
**Cloudflare Pages**; Supabase para Auth, PostgreSQL, Realtime e Edge Functions;
Upstash Redis para buffer temporário e deduplicação.

## Estado

As correções do PR #6 foram integradas para testes pré-abertura. A validação
ponta a ponta e a configuração de email permanecem pendentes no último registo.
Não tratar código compilado ou CI verde como autorização para abrir a plataforma.
Ver [estado e prioridades](docs/project-status.md).
Documentos legais e aceitação 2.0 preparados localmente; ver
[preparação jurídica](docs/legal-readiness.md) antes de publicar ou abrir acesso.

## Começar a desenvolver

Usar Node.js 24 e npm, na raiz do repositório:

```sh
npm ci
```

Criar `.env.local` a partir de `.env.example` com as duas variáveis públicas
Supabase. Não incluir segredos do servidor em `VITE_*` nem guardar `.env` no Git.

```sh
npm run dev
```

Verificações:

```sh
npm test
npm run lint
npm run build
```

O build gera `dist/`. Os testes locais usam PGlite por omissão e dependências
injetadas para as Functions: não provam o ambiente alojado. Ver
[desenvolvimento](docs/development.md) e [validação](docs/validation/README.md).

## Entender e alterar o código

- [Índice dos documentos](docs/README.md)
- [Arquitetura e mapa de ficheiros](docs/architecture.md)
- [Contratos cliente/servidor](docs/contracts.md)
- [Operação e lançamento coordenado](docs/operations/release.md)
- [Coordenação e passagem de tarefas](docs/coordination.md)
- [Instruções dos agentes](AGENTS.md)
- [Mensagens iniciais das áreas](docs/agent-prompts.md)

`src/pages/` contém ecrãs com rota; `src/components/modals/` contém os modais;
hooks, stores e helpers estão separados em `src/`. O servidor fica em
`supabase/`, as regressões em `tests/` e o CI em `.github/workflows/`.

## Avisos operacionais

Salas são privadas e clientes não publicam mensagens diretamente. Envio e
denúncia passam pelas Functions; SQL verifica elegibilidade, membership e prazos.
Denúncias podem guardar o conteúdo disponível, com retenção definida no schema.

Não reaplicar migrations históricas no projeto pré-abertura: o histórico remoto
registado usa um bootstrap consolidado. Confirmar/reconciliar histórico antes de
qualquer `supabase db push`. Deploy e alterações de serviços exigem autorização.

A [especificação original](docs/reference/original-specification.md) fica
preservada como referência histórica, não como instrução SQL ou contrato atual.
