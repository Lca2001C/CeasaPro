import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import { EstoqueService } from "../src/lib/services/estoque.service";

/**
 * Apaga e recalcula do zero os checkpoints do custo médio do estoque.
 *
 *   npx tsx scripts/recalcular-checkpoints.ts             # todas as empresas
 *   npx tsx scripts/recalcular-checkpoints.ts <tenantId>  # uma só
 *
 * A tabela é derivada do livro-razão: apagar nunca muda custo nenhum, só deixa
 * o repasse mais caro até o recálculo. Serve para a primeira carga depois do
 * deploy e para quando se suspeitar de um checkpoint (mudança na regra do
 * custo, movimento corrigido à mão no banco).
 */
async function main() {
  const alvo = process.argv[2];
  const tenants = alvo
    ? [{ id: alvo }]
    : await prisma.$queryRaw<{ id: string }[]>`
        SELECT DISTINCT "tenantId" AS id FROM stock_movements
      `;

  let produtos = 0;
  for (const [i, { id }] of tenants.entries()) {
    // Apagar e recalcular juntos: no meio do caminho a empresa nunca fica com
    // checkpoint de uns produtos e não de outros.
    produtos += await prisma.$transaction(
      async (tx) => {
        await tx.stockCostCheckpoint.deleteMany({ where: { tenantId: id } });
        return EstoqueService.atualizarCheckpoints(id, undefined, tx);
      },
      { timeout: 120_000 },
    );
    if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${tenants.length} empresas`);
  }
  console.log(`✔ ${tenants.length} empresas, ${produtos} checkpoints gravados.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
