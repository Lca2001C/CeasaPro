import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import { EstoqueService, saldoECustoMedio } from "../../src/lib/services/estoque.service";

/**
 * Tempo do repasse do custo médio numa empresa de carga, sem e com checkpoint:
 * a tela de Estoque (empresa inteira) e a consulta da venda (2 produtos).
 *
 *   npx tsx tests/load/medir-custo.ts
 *
 * Apaga e recria os checkpoints da empresa `Carga k6 001` — só banco local.
 */
async function medir(nome: string, fn: () => Promise<unknown>, vezes = 30) {
  await fn();
  const tempos: number[] = [];
  for (let i = 0; i < vezes; i++) {
    const t = performance.now();
    await fn();
    tempos.push(performance.now() - t);
  }
  tempos.sort((a, b) => a - b);
  const p = (q: number) => tempos[Math.min(tempos.length - 1, Math.floor(tempos.length * q))]!.toFixed(1);
  console.log(`${nome.padEnd(42)} p50=${p(0.5)}ms p95=${p(0.95)}ms`);
}

async function main() {
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { tradeName: "Carga k6 001" } });
  const produtos = await prisma.product.findMany({ where: { tenantId: tenant.id }, take: 2, select: { id: true } });
  const ids = produtos.map((p) => p.id);
  const movimentos = await prisma.stockMovement.count({ where: { tenantId: tenant.id } });
  console.log(`Empresa com ${movimentos} movimentos`);

  await prisma.stockCostCheckpoint.deleteMany({ where: { tenantId: tenant.id } });
  const antesTela = JSON.stringify(await EstoqueService.getPositions(tenant.id));
  await medir("sem checkpoint — tela de Estoque", () => EstoqueService.getPositions(tenant.id));
  await medir("sem checkpoint — venda (2 produtos)", () => saldoECustoMedio(prisma, tenant.id, ids));

  await EstoqueService.atualizarCheckpoints(tenant.id);
  const depoisTela = JSON.stringify(await EstoqueService.getPositions(tenant.id));
  await medir("com checkpoint — tela de Estoque", () => EstoqueService.getPositions(tenant.id));
  await medir("com checkpoint — venda (2 produtos)", () => saldoECustoMedio(prisma, tenant.id, ids));
  console.log(antesTela === depoisTela ? "✔ mesmo resultado com e sem checkpoint" : "✘ RESULTADO DIFERENTE");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
