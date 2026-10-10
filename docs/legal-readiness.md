# Aquecimento — preparação jurídica e de privacidade

10/10/2026; preparação local sobre `d32f451fcca016ca8753b56da94f1b1587d61579`.
Não é parecer jurídico nem certificação de conformidade. Nenhuma publicação,
configuração remota ou abertura de inscrições foi realizada.

## Decisões e documentos preparados

- Responsável: João António Pires Martins dos Santos Rodrigues, pessoa singular.
- Contacto público indicado: aquecimentoapp@gmail.com. Confirmar funcionamento,
  segurança e consulta regular; indicar um endereço não prova entrega.
- Marca Aquecimento, anteriormente Unider; projeto independente, sem afiliação,
  aprovação, representação ou suporte oficial da Universidade de Coimbra.
- Acesso apenas a maiores de 18 anos com email `@student.uc.pt`.

`src/lib/legal.ts` é a fonte única dos termos e privacidade 2.0, utilizada nas
rotas públicas `/termos` e `/privacidade` e no modal. Inclui responsável,
contacto, conduta, limites, denúncias, conservação, destinatários e direitos.
Aceitação contratual não é consentimento genérico RGPD.

O registo novo usa email/password, nome de uso, nascimento declarado, género
(com «prefiro não divulgar» por defeito) e aceitação explícita. Login existente não cria conta nem
repete a checkbox de registo. O modal pede confirmação explícita quando necessária;
`accept_terms(text,boolean)` regista versão, data e `adult_declared_at`.
`eligible` exige os três campos e conta não banida. Não é prova documental de
idade: pode haver declarações falsas. A migration de dados privados valida idade
e aceitação no trigger de criação, mas não comprova documentos nem leitura.
Contas antigas não têm data inventada; mantêm declaração e nova aceitação.
Nome/nascimento/género são privados, também existem em metadados Auth e são
eliminados com a conta. O responsável deve justificar a necessidade de conservar
a data completa (em vez de só maioridade) e de recolher nome/género; género não
tem uso de emparelhamento nem finalidade analítica no código atual. O pedido do
proprietário não substitui fundamento jurídico/minimização. Não anunciar
conformidade antes dessa avaliação; não recolher documentos de identificação.

Migration nova `20261010145007_adult_terms_v2.sql`: recusa clientes antigos e
declarações falsas/nulas, sem atribuir maioridade a contas existentes. A versão
1.1 exige nova aceitação. Guardar cópia exata do texto aceite em Git/artefacto
de release; qualquer alteração material posterior exige nova versão.

## Inventário e fundamentos propostos para validação

| Dados / finalidade | Conservação no código | Fundamento proposto, não parecer |
| --- | --- | --- |
| Email, ID, perfil, aceitação, declaração / acesso | Até eliminação da conta/perfil | Contrato, art. 6.º/1/b, só no necessário |
| Nome de uso, nascimento declarado, género opcional / registo privado | `account_details` e metadados Auth até eliminação da conta; backups têm ciclos próprios | Validar necessidade, fundamento e alternativa menos intrusiva antes de publicar; não presumir necessidade contratual para género |
| Fila, intenções, salas / emparelhamento | Limpeza de leases expiradas; intenções anteriores ao dia Lisboa menos um; salas hard close mais um dia | Necessidade contratual |
| Mensagens / entrega e recuperação | Redis: buffer inteiro 300 s após último append novo; deduplicação 600 s; sessionStorage tem ciclo independente | Contrato para dados comuns; categorias especiais exigem avaliação própria |
| Denúncia, conteúdo disponível, IDs/data/estado / abuso | Limpeza de registos com mais de 30 dias; texto pode identificar após eliminação | Interesse legítimo sujeito a ponderação; arts. 9.º/10.º não resolvidos automaticamente |
| Sugestões / quebra-gelos aprovados | Sem expiração automática; FK autor torna-se nula na eliminação | Definir necessidade e prazo; remover dados pessoais excessivos |
| IP/logs/backups / operação e segurança | Não comprovado pelos TTLs ou SQL | Confirmar fornecedores e prazos |
| Pedidos de direitos no Gmail / resposta | Prazo de arquivo a definir | Deveres RGPD; minimizar dados e acesso |

## Pendências antes de anunciar conformidade ou publicar

1. **Fornecedores/transferências:** registar entidades jurídicas, regiões reais,
   subcontratantes, DPA/contratos art. 28.º e garantias art. 44.º e seguintes.
   Supabase, Upstash e Cloudflare constam do código; SMTP não está escolhido.
   Gmail também processa pedidos de direitos: avaliar termos/conta adequados,
   segurança e transferências. Completar informação pública com países/garantias
   concretos e como obter cópia. Não afirmar «todos os dados ficam na UE».
2. **Conteúdo sensível:** conversas/denúncias podem conter categorias art. 9.º
   ou dados art. 10.º. Proibir envio não elimina o tratamento. Interesse legítimo
   não basta para essas categorias. Avaliar juridicamente comunicações privadas
   e prova denunciada; não inventar consentimento explícito nem aplicar a
   exceção de defesa de direitos a todas as conversas. Avaliar necessidade
   de AIPD em função da escala, risco e medidas antes da abertura.
3. **Ponderação/minimização:** documentar interesse legítimo para segurança:
   finalidade, necessidade, alternativas, impactos no denunciado, acesso limitado,
   prazo, contestação/oposição. Rever sugestões com dados pessoais sem prazo e
   arquivo da caixa de contacto. UUID não é dado anónimo.
4. **Operação:** validar Cron/eliminação reais, acesso restrito de moderação,
   MFA nas contas administrativas/email, prazos de logs/backups e eventual
   restauro. Testes locais não provam eliminação de todas as cópias alojadas.
5. **Enquadramento:** confirmar regime do chat privado e sugestões publicadas,
   informação obrigatória do prestador, eventual morada profissional e regras
   de comunicações/consumo. Gratuito ou pré-abertura não é dispensa automática;
   não classificar automaticamente o serviço como plataforma para todos os regimes.

## Procedimentos mínimos a pôr em prática

- Consultar contacto, confirmar receção e identificar pedidos de direitos.
  Responder em regra num mês; extensão exige fundamento e comunicação no primeiro
  mês. Verificar identidade proporcionalmente, sem pedir CC por rotina ou revelar
  dados de outro participante. Documentar resultado sem duplicar conversas.
- Apagamento: distinguir conta e dados restantes/exceções. Conservação excecional
  exige fundamento, acesso/prazo limitado e implementação; o código não suspende
  automaticamente limpeza por ordem judicial.
- Denúncias: avaliar caso a caso, documentar decisão e permitir contestação.
  Não prometer atendimento 24/7 ou encaminhamento automático para PJ/MP.
- Incidentes: conter, avaliar e documentar; art. 33.º prevê notificação à CNPD
  até 72 horas após conhecimento quando aplicável; art. 34.º prevê comunicação
  aos titulares em situações de elevado risco. Não comunicar indiscriminadamente.

## Renomeação e lançamento

Marca visível, título e favicon passam a Aquecimento localmente. Preservar
histórico/migrations e identificadores técnicos `unider_private`, storage e
fixtures para não quebrar sessões ou APIs. Pasta local, GitHub e nomes/URLs de
serviços mantêm-se: alterações externas precisam de plano e autorização.
Templates SMTP alojados não foram alterados.

Antes de publicar: resolver pendências, aprovar texto final, reconciliar histórico
do bootstrap, aplicar incrementais em ordem e coordenar backend/Pages. Cliente
2.0 não funciona contra RPC antigo; backend 2.0 recusa aceitação 1.1.
Não publicar uma metade isoladamente. Ver [operação](operations/release.md).

## Fontes primárias consultadas em 10/10/2026

- [RGPD oficial](https://eur-lex.europa.eu/eli/reg/2016/679/oj?locale=pt):
  arts. 5.º, 6.º, 9.º, 10.º, 12.º–22.º, 25.º, 28.º, 32.º–36.º, 44.º seguintes.
- [CEPD — necessidade contratual online](https://www.edpb.europa.eu/documents/guideline/guidelines-22019-on-the-processing-of-personal-data-under-article-61b-gdpr-in_en).
- [CNPD — consentimento](https://www.cnpd.pt/organizacoes/areas-tematicas/consentimento/).
- [CNPD — direitos](https://www.cnpd.pt/cidadaos/direitos/).
- [CNPD — avaliação de impacto](https://www.cnpd.pt/organizacoes/outras-obrigacoes/avaliacao-de-impacto/).

As fontes legais não demonstram configurações ou substituem análise do caso.

## Verificação e entrega local

Ficheiros desta entrega: `src/lib/legal.ts`, `src/components/LegalText.tsx`,
`src/pages/Legal.tsx`, `src/App.tsx`, `src/pages/Login.tsx`, `src/pages/Lobby.tsx`,
`src/components/modals/TermsModal.tsx`, `src/main.tsx`, `index.html`,
`public/favicon.svg`, nova migration de maioridade, `tests/legal.test.cjs` e
regressões existentes de base/browser. Atualizados README e guias de leitura,
arquitetura, contratos, prompts das áreas, operação e estado. Alterações B01
preexistentes foram preservadas; nenhuma migration histórica foi modificada.

- `npm test`, com cinco fixtures Chrome: **104 passaram, 0 falhas, 2 excluídos**
  pela limitação de concorrência PGlite. Sem pedidos a serviços externos.
- `node --test tests/database.test.mjs` numa base PostgreSQL 18.6 local nova:
  **19 passaram, 0 falhas/exclusões**, incluindo concorrência e a migration nova.
- `npm run lint`, `npm run build`, Deno frozen-lock das quatro Functions,
  testes de links e `git diff --check`: aprovados. Build usou configuração
  pública sintética; o `dist` **não pode ser publicado**.
- Primeira tentativa do gate sob sandbox falhou por bloqueio de rede localhost
  e realpath. A execução autorizada das fixtures locais passou; não se alteraram
  as restrições de pedidos externos dos testes para contornar estas falhas.
- Testado: declaração obrigatória no modal, descarte ao mudar conta, erro/retry,
  RPC com maioridade falsa/nula/ausente, versão antiga, anónimo, ban, eliminação,
  escrita direta recusada e páginas legais acessíveis antes/depois do login.
- Servidor PostgreSQL descartável parado após teste; apenas dados sintéticos
  na pasta ignorada `node_modules/.cache/aquecimento-legal-pg-20261010`.

Diff disponível localmente; sem commit/push/deploy nesta entrega. A validação
alojada de Auth, Realtime, Redis, SMTP, Cron e eliminação continua separada.
Os testes aprovados não resolvem as pendências jurídicas acima.
