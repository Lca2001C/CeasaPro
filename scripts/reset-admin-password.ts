import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";

/**
 * Grava a senha nova do super-admin E derruba as sessões dele, numa transação.
 *
 * O motivo mais provável para rodar este script é a credencial ter vazado. Só
 * trocar o hash deixava o invasor já logado dentro de `/admin`: o refresh de
 * até 30 dias continuava rotacionando e o access antigo seguia valendo na
 * escrita. Aqui se faz o mesmo que `revokeAllForUser(…, "PASSWORD")` faz em
 * toda troca de senha do app — revoga os refresh tokens vivos e incrementa
 * `sessionEpoch` —, só que dentro da mesma transação da senha.
 *
 * Exportada (e com o client como parâmetro) para o teste de integração.
 */
export async function redefinirSenhaDoSuperAdmin(
  db: PrismaClient,
  email: string,
  passwordHash: string,
): Promise<number> {
  return db.$transaction(async (tx) => {
    const admins = await tx.user.findMany({
      where: { email, tenantId: null, role: "SUPER_ADMIN" },
      select: { id: true },
    });
    if (admins.length === 0) return 0;
    const ids = admins.map((a) => a.id);

    await tx.user.updateMany({
      where: { id: { in: ids } },
      data: {
        passwordHash,
        // Obriga a troca no primeiro login: a senha temporária passa pelo terminal
        // (e pelo histórico do shell), então não deve continuar valendo.
        mustChangePassword: true,
        sessionEpoch: { increment: 1 },
      },
    });
    await tx.refreshToken.updateMany({
      where: { userId: { in: ids }, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "PASSWORD" },
    });
    return ids.length;
  });
}

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
  const prisma = new PrismaClient();
  try {
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

    const count = await redefinirSenhaDoSuperAdmin(prisma, email, passwordHash);

    if (count === 0) {
      console.error(`Nenhum SUPER_ADMIN encontrado com o e-mail ${email}. Nada foi alterado.`);
      process.exitCode = 1;
      return;
    }

    console.log(`Usuários atualizados: ${count} (todas as sessões abertas foram encerradas)`);
    if (!senhaInformada) {
      console.log("");
      console.log("Senha temporária (copie agora — não será exibida de novo):");
      console.log(`  ${newPassword}`);
      console.log("");
      console.log("O primeiro login vai exigir a troca desta senha.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Só roda quando executado como script (`tsx scripts/reset-admin-password.ts`),
// não quando o teste importa a função acima.
if (/reset-admin-password\.[cm]?[tj]s$/.test(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
