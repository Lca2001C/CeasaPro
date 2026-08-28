import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";

const prisma = new PrismaClient();

/**
 * Reseta a senha do super-admin.
 *
 * A senha NUNCA é literal aqui: este arquivo é versionado, e um segredo commitado
 * continua no histórico do git mesmo depois de removido do código — qualquer clone
 * ou backup do repositório entrega a credencial. Ou vem de `ADMIN_PASSWORD`, ou é
 * sorteada e mostrada uma única vez no terminal.
 *
 * Uso:
 *   npx tsx scripts/reset-admin-password.ts                  # sorteia e imprime
 *   ADMIN_PASSWORD='...' npx tsx scripts/reset-admin-password.ts
 *   ADMIN_EMAIL='outro@dominio' npx tsx scripts/reset-admin-password.ts
 */
async function main() {
  const email = process.env.ADMIN_EMAIL ?? process.env.SEED_SUPERADMIN_EMAIL;
  if (!email) {
    throw new Error(
      "Informe o e-mail do super-admin em ADMIN_EMAIL (ou SEED_SUPERADMIN_EMAIL no .env).",
    );
  }

  const senhaInformada = process.env.ADMIN_PASSWORD;
  // 24 bytes em base64url ≈ 32 caracteres imprevisíveis.
  const newPassword = senhaInformada ?? randomBytes(24).toString("base64url");

  const passwordHash = await hashPassword(newPassword);

  const result = await prisma.user.updateMany({
    where: {
      email,
      tenantId: null,
      role: "SUPER_ADMIN",
    },
    data: {
      passwordHash,
      // Obriga a troca no primeiro login: a senha temporária passa pelo terminal
      // (e pelo histórico do shell), então não deve continuar valendo.
      mustChangePassword: true,
    },
  });

  if (result.count === 0) {
    console.error(`Nenhum SUPER_ADMIN encontrado com o e-mail ${email}. Nada foi alterado.`);
    process.exit(1);
  }

  console.log(`Usuários atualizados: ${result.count}`);
  if (!senhaInformada) {
    console.log("");
    console.log("Senha temporária (copie agora — não será exibida de novo):");
    console.log(`  ${newPassword}`);
    console.log("");
    console.log("O primeiro login vai exigir a troca desta senha.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
