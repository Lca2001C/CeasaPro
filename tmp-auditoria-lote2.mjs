export const meta = {
  name: 'auditoria-lote2-achar',
  description: 'Lote 2 da auditoria: acha bugs em super-admin, cadastro/trial e produtos-estoque (só investigação)',
  phases: [{ title: 'Investigar', detail: 'admin, cadastro e estoque — leitura apenas, no máximo 3 achados cada' }],
}

const REGRAS = `
CeasaPro: SaaS multi-tenant para boxes do CEASA. Next.js 16 App Router, React 19,
Prisma 6 + PostgreSQL, Zod 4, Vitest + Playwright.
Repositório: C:/Users/x19991860/Documents/Lucas/CeasaPro — você já está nele.
Escreva em português do Brasil.

ARQUITETURA
- Route/Action fino -> Service -> Prisma. Wrappers: src/lib/http/with-action.ts
  (withTenantAction/withAdminAction, opção \`module:\` para gate de plano) e
  src/lib/http/with-route.ts.
- Isolamento: getTenantPrisma(tenantId) (src/lib/db/tenant-prisma.ts) injeta
  where.tenantId e where.deletedAt=null nos modelos de src/lib/db/models-tenant.ts.
  \`prisma\` cru só em auth, super-admin, billing/webhook e push.
- Dinheiro é Prisma.Decimal sempre; helpers em src/lib/money.ts; fórmulas em
  src/lib/services/financial-calc.service.ts.
- Fuso: src/lib/tz.ts (America/Sao_Paulo); servidor em UTC. setHours/getMonth/
  new Date("YYYY-MM-DD") crus são bug.
- Erros: AppError -> { ok:false, error:{ code, message } } -> toast.

FORA DE ESCOPO — não investigue nem reporte
PDV em obras: src/app/(app)/vendas/nova/**, src/lib/services/vendas.service.ts,
src/lib/validations/venda.ts. Também há trabalho NÃO COMMITADO de outra pessoa em
cancelamento de assinatura (src/components/billing/cancelar-assinatura.tsx,
tests/integration/billing-cancel.test.ts, plano.service.ts, plano.actions.ts) —
ignore o que estiver claramente inacabado ali.

JÁ CORRIGIDO — não reporte de novo
- pdfmake com \`this\` errado (PDF 500): corrigido.
- atualizarHigienizacao sem gate de módulo: corrigido.
- PackagingMovement fora de TENANT_MODELS: corrigido, e agora há teste
  (tests/unit/models-tenant-cobertura.test.ts) provando que os 24 modelos com
  tenantId estão protegidos ou são exceção declarada de plataforma.
- ALLOW_INSECURE_COOKIES / CSP_REPORT_ONLY: já checados pelo preflight e
  documentados no .env.example.
- Rotas /api sem wrapper: as sem wrapper são legítimas (auth, cron com
  CRON_SECRET, webhook com HMAC, health).
- Stack trace não vaza (error-response.ts devolve código opaco + ref).
- Índices SQL: medidos como desnecessários. NÃO proponha índice sem medição.
- Lote 1 (todos corrigidos hoje, NÃO reporte de novo):
  * login Google adotava cadastro público não confirmado mantendo a senha do
    impostor, e dava trial a empresa cadastrada pelo admin;
  * googleSub de conta excluída travava o retorno do cliente (violação de
    índice único -> 500 no callback);
  * new Date("YYYY-MM-DD") cru em fiado/compras/caixas/embalagens/
    higienização (data voltava um dia) — agora parseFormDateTz, com teste que
    cobra o padrão em todo src/lib/services;
  * pagamento de fiado com ler-somar-escrever (dois simultâneos perdiam um);
  * total de caixas do painel de fiado contava o mesmo cliente uma vez por
    conta;
  * saldoPorCliente ignorava ESTORNO_SAIDA e a guarda de RETORNO era global,
    não por cliente.
- Em billing há 3 achados do lote 1 ainda ABERTOS de propósito (cobrança PIX
  vencida travando /assinatura; QR substituído não cancelado no MP + webhook
  sem conferir valor; take:200 da reconciliação). Não são frente deste lote.

O QUE CONTA COMO ACHADO
Defeito que um usuário real do CEASA encontraria: 500/tela branca, fluxo travado,
dado errado ou perdido, cálculo financeiro incorreto, borda de fuso, corrida /
dupla submissão / falta de idempotência, vazamento entre empresas, bypass de
plano ou permissão, transação faltando (metade persiste), erro sem mensagem útil.

O QUE NÃO CONTA
Estilo, nomenclatura, refactor, "falta teste" sozinho, especulação sem linha de
código, ideia de recurso novo.

COMO TRABALHAR
Somente LEITURA — não edite, crie ou apague arquivo. Não rode a suíte de testes
(não há banco nesta execução). Use bash (grep/find/sed -n) e leia os arquivos.
Antes de afirmar, abra o código e siga a chamada até o service e o schema Prisma.
Cite arquivo:linha e o TRECHO exato que sustenta a afirmação — outro agente vai
tentar derrubar seu achado lendo esse trecho, e achado sem evidência cai na hora.
Cheque se já existe teste cobrindo (grep em tests/) e diga qual.

NO MÁXIMO 3 ACHADOS — os de maior impacto. Lista vazia é resposta legítima e
melhor que ruído. Prefira profundidade a volume.
`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'coberto'],
  properties: {
    coberto: { type: 'string', description: 'O que você leu de fato, em 1-3 frases.' },
    findings: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['titulo', 'arquivo', 'linha', 'gravidade', 'impactoUsuario', 'cenarioFalha', 'evidencia', 'testeExistente', 'correcaoSugerida'],
        properties: {
          titulo: { type: 'string' },
          arquivo: { type: 'string' },
          linha: { type: 'integer' },
          gravidade: { type: 'string', enum: ['alta', 'media', 'baixa'] },
          impactoUsuario: { type: 'string' },
          cenarioFalha: { type: 'string' },
          evidencia: { type: 'string' },
          testeExistente: { type: 'string' },
          correcaoSugerida: { type: 'string' },
        },
      },
    },
  },
}

const FRENTES = [
  {
    key: 'admin',
    foco: `Área do super-admin.
Leia: src/lib/services/admin.service.ts, src/actions/admin*.actions.ts,
src/app/(admin)/**, src/lib/services/admin-notifications.service.ts,
src/lib/services/plano.service.ts (só a parte de planos, não o cancelamento
inacabado), src/lib/http/with-action.ts (withAdminAction).
Perguntas: o login administrativo alcança dado de cliente (LGPD)? excluir
empresa deixa órfão que impede recadastro? mudar plano de empresa ativa muda o
valor já cobrado ou libera módulo sem pagar? suspender/bloquear derruba as
sessões abertas? criar empresa com e-mail em uso vaza a existência da conta?
a senha temporária vai para log ou resposta? paginação/busca do admin usa
prisma cru sem filtro e mostra registro excluído? ação de admin sem auditoria?`,
  },
  {
    key: 'cadastro',
    foco: `Cadastro público, confirmação de e-mail, teste grátis e primeiro acesso.
Leia: src/lib/services/signup.service.ts, src/app/api/auth/signup/route.ts,
src/app/(auth)/cadastro/**, src/lib/services/tenant-provisioning.ts,
src/lib/billing/status.ts (trial), src/lib/services/onboarding*.ts se existir,
src/app/(app)/primeiro-acesso/** ou equivalente, src/lib/validations/signup*.
Perguntas: dois cadastros simultâneos com o mesmo e-mail criam duas empresas?
o token de confirmação expira e é de uso único? reenviar confirmação permite
enumerar e-mail cadastrado? o trial pode ser renovado cadastrando de novo com
o mesmo e-mail (ou com ponto/maiúscula no gmail)? a empresa nasce sem plano ou
sem assinatura se algo falhar no meio (transação)? quem nunca confirmou o
e-mail entra pelo login? o primeiro acesso obriga trocar a senha temporária?`,
  },
  {
    key: 'estoque',
    foco: `Produtos, estoque e compras/fornecedores.
Leia: src/lib/services/produtos.service.ts, estoque.service.ts,
compras.service.ts, fornecedores.service.ts, os actions/rotas correspondentes,
src/app/(app)/produtos/**, src/app/(app)/estoque/**, src/app/(app)/compras/**,
e o custo médio em financial-calc.service.ts.
NÃO investigue a baixa de estoque feita pelo PDV (vendas.service.ts está fora).
Perguntas: o custo médio quebra com entrada de quantidade zero ou preço zero
(divisão por zero)? excluir produto com movimentação deixa histórico órfão ou
some com o CMV? editar a unidade de venda de um produto com estoque converte
errado? compra com frete rateia com sobra de centavo? estoque pode ficar
negativo por caminho que não seja o PDV? quantidade decimal (kg) perde
precisão (float em vez de Decimal)? excluir fornecedor com compras? duas
entradas simultâneas do mesmo produto perdem uma (ler-somar-escrever)?`,
  },
]
phase('Investigar')
log('lote 2 de 4: admin, cadastro/trial, produtos-estoque — no máximo 3 achados por frente')

const res = await parallel(
  FRENTES.map((f) => () =>
    agent(
      `${REGRAS}

SUA FRENTE: ${f.key}

${f.foco}

Investigue com profundidade e devolva no schema pedido.`,
      { label: `achar:${f.key}`, phase: 'Investigar', schema: SCHEMA, effort: 'high' },
    ),
  ),
)

const validos = res.filter(Boolean)
const achados = validos.flatMap((r, i) =>
  (r.findings || []).map((f) => ({ frente: FRENTES[i] ? FRENTES[i].key : '?', ...f })),
)
log(`${achados.length} achados brutos, de ${validos.length}/${FRENTES.length} frentes`)

return {
  lote: 2,
  frentesOk: validos.length,
  frentesTotal: FRENTES.length,
  cobertura: validos.map((r, i) => ({ frente: FRENTES[i] ? FRENTES[i].key : '?', coberto: r.coberto })),
  achados,
}
