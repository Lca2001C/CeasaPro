import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import { EmbalagensService } from "../src/lib/services/embalagens.service";

/**
 * Passa para o estoque de caixas plásticas o saldo que o tipo de embalagem
 * "Caixa plástica" tinha antes do vínculo (migration
 * `20261027120000_caixas_embalagens_vinculo`).
 *
 *   npx tsx scripts/vincular-caixas-embalagens.ts             # todas as empresas
 *   npx tsx scripts/vincular-caixas-embalagens.ts <tenantId>  # uma só
 *
 * Rodar uma vez depois do deploy. Idempotente: empresa já transferida, sem tipo
 * vinculado ou sem saldo no tipo é pulada.
 */
async function main() {
  const alvo = process.argv[2];
  const tenants = alvo
    ? [{ id: alvo }]
    : await prisma.$queryRaw<{ id: string }[]>`
        SELECT DISTINCT t."tenantId" AS id
        FROM packaging_types t
        JOIN packaging_movements m ON m."packagingTypeId" = t.id
        WHERE t."caixaPlastica" AND t."deletedAt" IS NULL
      `;

  let empresas = 0;
  let caixas = 0;
  for (const { id } of tenants) {
    const transferidas = await EmbalagensService.transferirSaldoParaCaixas(id);
    if (transferidas > 0) {
      empresas += 1;
      caixas += transferidas;
    }
  }
  console.log(`✔ ${empresas} empresa(s), ${caixas} caixa(s) transferidas para o estoque de caixas.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
