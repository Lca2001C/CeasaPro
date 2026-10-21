import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/auth/password";
import { TERMS_VERSION } from "../../src/lib/legal";
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_PACKAGING_TYPES } from "../../src/lib/constants";
import { ORIGEM_COMPRA, ORIGEM_VENDA } from "../../src/lib/estoque/origens";

/**
 * Massa do teste de carga: N empresas `Carga k6 NNN`, cada uma com um dono de
 * senha conhecida, 30 produtos e ~5.100 movimentos de estoque espalhados por
 * dois anos — o livro-razão de um box que já usa o sistema há tempo, que é onde
 * o custo médio (`sqlCustoEstoque`) pesa.
 *
 *   npx tsx tests/load/seed-carga.ts            # cria (idempotente: recria)
 *   npx tsx tests/load/seed-carga.ts --limpar   # só apaga
 *
 * Grava `tests/load/usuarios.json` para o script do k6. Só roda contra banco
 * local: apaga e recria empresas.
 */

const EMPRESAS = Number(process.env.K6_EMPRESAS ?? 100);
const PRODUTOS = 30;
const MOVIMENTOS_POR_PRODUTO = 170;
const SENHA = process.env.K6_SENHA ?? "carga-k6-2026";
const PREFIXO = "Carga k6 ";
const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "db", "postgres"]);

const NOMES = [
  "Tomate", "Batata", "Cebola", "Cenoura", "Alface", "Repolho", "Abobrinha", "Pepino",
  "Pimentão", "Chuchu", "Beterraba", "Mandioca", "Banana", "Laranja", "Maçã", "Mamão",
  "Melancia", "Abacaxi", "Uva", "Limão", "Manga", "Goiaba", "Morango", "Quiabo",
  "Jiló", "Couve", "Brócolis", "Couve-flor", "Berinjela", "Inhame",
];

const prisma = new PrismaClient();

function exigirBancoLocal() {
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* cai no erro abaixo */
  }
  if (!HOSTS_LOCAIS.has(host)) {
    throw new Error(`O seed de carga apaga e recria empresas: só roda em banco local (host: ${host || "?"}).`);
  }
}

const emailDe = (n: number) => `k6-${String(n).padStart(3, "0")}@carga.example.com`;

async function limpar() {
  const tenants = await prisma.tenant.findMany({
    where: { tradeName: { startsWith: PREFIXO } },
    select: { id: true },
  });
  const ids = tenants.map((t) => t.id);
  if (ids.length === 0) return 0;
  const where = { tenantId: { in: ids } };
  // Mesma ordem de `tests/helpers/factory.ts#cleanupTenants`: os FKs Restrict de
  // Product exigem movimentos e itens fora antes dos produtos.
  await prisma.auditLog.deleteMany({ where });
  await prisma.adminNotification.deleteMany({ where });
  await prisma.plasticCrateMovement.deleteMany({ where });
  await prisma.packagingSale.deleteMany({ where });
  await prisma.packagingType.deleteMany({ where });
  await prisma.$executeRaw`DELETE FROM "stock_movements" WHERE "tenantId" = ANY(${ids}::text[])`;
  await prisma.creditPayment.deleteMany({ where });
  await prisma.creditAccount.deleteMany({ where });
  await prisma.saleItem.deleteMany({ where });
  await prisma.sale.deleteMany({ where });
  await prisma.purchaseItem.deleteMany({ where });
  await prisma.purchase.deleteMany({ where });
  await prisma.expense.deleteMany({ where });
  await prisma.expenseCategory.deleteMany({ where });
  await prisma.product.deleteMany({ where });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  // E-mail é único na tabela inteira: um dono órfão impediria recriar.
  await prisma.user.deleteMany({ where: { email: { endsWith: "@carga.example.com" } } });
  return ids.length;
}

async function criar() {
  const plano = await prisma.plan.findUnique({ where: { slug: "padrao" } });
  if (!plano) throw new Error("Plano 'padrao' não encontrado. Rode `npm run db:seed` antes.");

  const passwordHash = await hashPassword(SENHA);
  const agora = new Date();
  const fimDoPeriodo = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000);
  const ids: string[] = [];

  for (let n = 1; n <= EMPRESAS; n++) {
    const tenant = await prisma.tenant.create({
      data: {
        tradeName: `${PREFIXO}${String(n).padStart(3, "0")}`,
        status: "ACTIVE",
        uf: "MG",
        onboardingCompletedAt: agora,
        termsAcceptedAt: agora,
        termsVersion: TERMS_VERSION,
        subscription: {
          create: {
            planId: plano.id,
            status: "ATIVO",
            monthlyAmount: plano.priceMonthly,
            activatedAt: agora,
            currentPeriodEnd: fimDoPeriodo,
            graceDays: 5,
          },
        },
        users: {
          create: {
            email: emailDe(n),
            name: `Dono ${n}`,
            passwordHash,
            role: "OWNER",
            emailVerifiedAt: agora,
          },
        },
        expenseCategories: {
          create: DEFAULT_EXPENSE_CATEGORIES.map((name) => ({ name, isDefault: true })),
        },
        packagingTypes: { create: DEFAULT_PACKAGING_TYPES.map((name) => ({ name })) },
      },
      select: { id: true },
    });
    ids.push(tenant.id);

    await prisma.product.createMany({
      data: NOMES.slice(0, PRODUTOS).map((name, i) => ({
        tenantId: tenant.id,
        name,
        saleUnit: "CAIXA" as const,
        salePrice: new Prisma.Decimal(5 + (i % 6)),
        active: true,
      })),
    });

    // Uma ENTRADA de 100 a cada três SAÍDAS de 20: o saldo nunca fica negativo
    // e termina em 1.760 por produto, folga de sobra para as vendas do teste.
    await prisma.$executeRaw`
      INSERT INTO "stock_movements"
        (id, "tenantId", "productId", type, quantity, "unitCost", "sourceType", "sourceId", "movedAt", "createdAt")
      SELECT 'k6m' || md5(p.id || ':' || g),
             p."tenantId", p.id,
             (CASE WHEN g % 4 = 0 THEN 'ENTRADA' ELSE 'SAIDA' END)::"StockMovementType",
             CASE WHEN g % 4 = 0 THEN 100 ELSE 20 END,
             CASE WHEN g % 4 = 0 THEN round((2 + random() * 3)::numeric, 4) END,
             CASE WHEN g % 4 = 0 THEN ${ORIGEM_COMPRA} ELSE ${ORIGEM_VENDA} END,
             'k6s' || md5(p.id || ':' || g),
             t.ts, t.ts
      FROM "products" p
      CROSS JOIN generate_series(0, ${MOVIMENTOS_POR_PRODUTO - 1}) g
      CROSS JOIN LATERAL (
        SELECT now() - interval '730 days'
               + g * (interval '730 days' / ${MOVIMENTOS_POR_PRODUTO}) AS ts
      ) t
      WHERE p."tenantId" = ${tenant.id}
    `;
    if (n % 10 === 0) console.log(`  ${n}/${EMPRESAS} empresas`);
  }

  await prisma.$executeRawUnsafe(`ANALYZE "stock_movements"`);
  return ids;
}

async function main() {
  exigirBancoLocal();
  const apagadas = await limpar();
  if (apagadas > 0) console.log(`✔ ${apagadas} empresas de carga apagadas`);
  if (process.argv.includes("--limpar")) return;

  console.log(`Criando ${EMPRESAS} empresas de carga…`);
  const ids = await criar();

  // Os ids dos produtos vão junto: o k6 não monta o carrinho lendo o HTML do PDV.
  const produtos = await prisma.product.findMany({
    where: { tenantId: { in: ids } },
    select: { id: true, tenantId: true, salePrice: true },
  });
  const usuarios = ids.map((tenantId, i) => ({
    email: emailDe(i + 1),
    password: SENHA,
    produtos: produtos
      .filter((p) => p.tenantId === tenantId)
      .map((p) => ({ id: p.id, preco: Number(p.salePrice) })),
  }));
  const arquivo = join(__dirname, "usuarios.json");
  writeFileSync(arquivo, JSON.stringify(usuarios, null, 2));
  console.log(`✔ ${EMPRESAS} empresas, ${EMPRESAS * PRODUTOS * MOVIMENTOS_POR_PRODUTO} movimentos. Logins em ${arquivo}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
