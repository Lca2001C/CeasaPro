import "dotenv/config";
import { PrismaClient, Prisma } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_PACKAGING_TYPES,
} from "../src/lib/constants";

const prisma = new PrismaClient();

async function main() {
  // 1) Super-admin
  const adminEmail = (process.env.SEED_SUPERADMIN_EMAIL ?? "admin@ceasapro.com.br").trim().toLowerCase();
  const adminPassword = process.env.SEED_SUPERADMIN_PASSWORD ?? "ceasapro123";

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        email: adminEmail,
        name: "Administrador",
        passwordHash: await hashPassword(adminPassword),
        role: "SUPER_ADMIN",
        mustChangePassword: true,
      },
    });
    console.log(`✔ Super-admin criado: ${adminEmail}`);
  } else {
    console.log(`• Super-admin já existe: ${adminEmail}`);
  }

  // 2) Plano padrão
  const plan = await prisma.plan.upsert({
    where: { slug: "padrao" },
    update: {},
    create: {
      name: "Plano Padrão",
      slug: "padrao",
      priceMonthly: new Prisma.Decimal("49.90"),
      maxUsers: 3,
      active: true,
    },
  });
  console.log(`✔ Plano padrão: ${plan.name} (R$ ${plan.priceMonthly})`);

  // 3) Empresa demo (opcional)
  if (process.env.SEED_DEMO === "true") {
    const demoEmail = "demo@ceasapro.com.br";
    const existingDemo = await prisma.user.findUnique({ where: { email: demoEmail } });
    if (!existingDemo) {
      const now = new Date();
      const trialEnd = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
      const tenant = await prisma.tenant.create({
        data: {
          tradeName: "Hortifruti Demo",
          legalName: "Hortifruti Demo LTDA",
          phone: "31999990000",
          status: "ACTIVE",
          onboardingCompletedAt: new Date(),
          subscription: {
            create: {
              planId: plan.id,
              status: "TRIAL",
              monthlyAmount: plan.priceMonthly,
              trialEndsAt: trialEnd,
              currentPeriodEnd: trialEnd,
              graceDays: 5,
            },
          },
          users: {
            create: {
              email: demoEmail,
              name: "Dono Demo",
              passwordHash: await hashPassword("demo123"),
              role: "OWNER",
            },
          },
          expenseCategories: {
            create: DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
              name,
              isDefault: true,
            })),
          },
          packagingTypes: {
            create: DEFAULT_PACKAGING_TYPES.map((name) => ({ name })),
          },
        },
      });
      console.log(`✔ Empresa demo criada: ${tenant.tradeName} (login: ${demoEmail} / demo123)`);
    } else {
      // Garante que o demo pule o onboarding (empresa de exemplo já configurada).
      await prisma.tenant.updateMany({
        where: { users: { some: { email: demoEmail } }, onboardingCompletedAt: null },
        data: { onboardingCompletedAt: new Date() },
      });
      // Tipos de embalagem padrão (Fase 2) — idempotente.
      const demoTenant = await prisma.tenant.findFirst({
        where: { users: { some: { email: demoEmail } } },
      });
      if (demoTenant) {
        await prisma.packagingType.createMany({
          data: DEFAULT_PACKAGING_TYPES.map((name) => ({ tenantId: demoTenant.id, name })),
          skipDuplicates: true,
        });
      }
      console.log("• Empresa demo já existe (tipos de embalagem garantidos)");
    }
  }

  console.log("Seed concluído.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
