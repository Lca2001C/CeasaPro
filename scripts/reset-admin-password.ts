import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";

const prisma = new PrismaClient();

async function main() {
  const email = "admin@ceasapro.com.br";
  const newPassword = "C3asaAdmin#2026$Pro";

  const passwordHash = await hashPassword(newPassword);

  const result = await prisma.user.updateMany({
    where: {
      email,
      tenantId: null,
      role: "SUPER_ADMIN",
    },
    data: {
      passwordHash,
      mustChangePassword: true,
    },
  });

  console.log(`Usuários atualizados: ${result.count}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });