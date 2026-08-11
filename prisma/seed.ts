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
  // Sem senha hardcoded no código (evita vazar credencial no repositório).
  const adminPassword = process.env.SEED_SUPERADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error(
      "Defina SEED_SUPERADMIN_PASSWORD no .env antes de rodar o seed (nao ha senha padrao no codigo).",
    );
  }

  // E-mail é único por (tenantId, email) — super-admin não tem tenant, então findFirst.
  const existingAdmin = await prisma.user.findFirst({
    where: { email: adminEmail, tenantId: null },
  });
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

  // 2) Planos (o Padrão inclui todos os módulos; o Básico só o núcleo).
  //    Ter 2+ planos ativos habilita a troca de plano na tela "Meu plano".
  const plan = await prisma.plan.upsert({
    where: { slug: "padrao" },
    update: {},
    create: {
      name: "Plano Padrão",
      slug: "padrao",
      priceMonthly: new Prisma.Decimal("49.90"),
      maxUsers: 3,
      active: true,
      // sem features.modules ⇒ todos os módulos opcionais liberados (retrocompat).
    },
  });
  console.log(`✔ Plano: ${plan.name} (R$ ${plan.priceMonthly})`);

  const planoBasico = await prisma.plan.upsert({
    where: { slug: "basico" },
    update: {},
    create: {
      name: "Plano Básico",
      slug: "basico",
      priceMonthly: new Prisma.Decimal("29.90"),
      maxUsers: 2,
      active: true,
      features: { modules: [] }, // só os recursos básicos (núcleo)
    },
  });
  console.log(`✔ Plano: ${planoBasico.name} (R$ ${planoBasico.priceMonthly})`);

  // 3) Empresa demo (opcional) — conta de EXEMPLO para dev/E2E, sem dados reais.
  if (process.env.SEED_DEMO === "true") {
    const demoEmail = "demo@ceasapro.com.br";
    const demoPassword = process.env.SEED_DEMO_PASSWORD ?? "demo123";
    const existingDemo = await prisma.user.findFirst({ where: { email: demoEmail } });
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
              passwordHash: await hashPassword(demoPassword),
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
      console.log(`✔ Empresa demo criada: ${tenant.tradeName} (login: ${demoEmail})`);
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
