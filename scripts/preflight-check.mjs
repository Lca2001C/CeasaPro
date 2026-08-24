// Verificação pré-flight do CeasaPro — roda antes da build/deploy.
// Uso: node scripts/preflight-check.mjs   (ou: npm run preflight)
//
// Confere três coisas, nesta ordem:
//   1. Variáveis de ambiente: presença e formato.
//   2. Conexão real com o PostgreSQL e dados mínimos (pelo menos um plano ativo).
//   3. Ausência de resíduo do antigo período gratuito (trial) no banco.
//
// Sai com código 1 em qualquer erro, para travar o pipeline antes do deploy.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// ─────────────────────────── Saída ───────────────────────────

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (color ? `\u001b[${code}m${s}\u001b[0m` : s);
const ok = (s) => console.log(`${paint(32, "✔")} ${s}`);
const warn = (s) => console.log(`${paint(33, "!")} ${s}`);
const err = (s) => console.log(`${paint(31, "✘")} ${s}`);
const section = (s) => console.log(`\n${paint(36, `── ${s} `.padEnd(60, "─"))}`);

const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
  err(message);
}

function advise(message) {
  warnings.push(message);
  warn(message);
}

// Em produção tudo é obrigatório. Fora dela (CI, dev) a ausência de um segredo
// de terceiros vira aviso — o que ainda permite validar formato, banco e trial.
const isProd = process.env.NODE_ENV === "production";

// ─────────────────────── 1) Variáveis de ambiente ───────────────────────

/**
 * @typedef {object} EnvRule
 * @property {string} name
 * @property {string} description
 * @property {boolean} [prodOnly]   só é exigida em produção
 * @property {boolean} [optional]   nunca bloqueia: ausência vira aviso
 * @property {(value: string) => string | null} [validate] devolve a mensagem de erro, ou null
 */

/**
 * Comprimento mínimo de segredo. Só bloqueia em produção: em dev e no CI os
 * valores são propositalmente curtos e legíveis ("dev-cron-secret"), e travar
 * o pipeline por causa disso não protege ninguém.
 */
const minLength = (n) => (v) => {
  if (v.length >= n) return null;
  const message = `precisa ter pelo menos ${n} caracteres (tem ${v.length})`;
  return isProd ? message : null;
};

const startsWith = (prefix) => (v) =>
  v.startsWith(prefix) ? null : `deveria começar com "${prefix}"`;

/** @type {EnvRule[]} */
const ENV_RULES = [
  {
    name: "DATABASE_URL",
    description: "PostgreSQL (connection string pooled)",
    validate: (v) =>
      /^postgres(ql)?:\/\//.test(v) ? null : 'deveria começar com "postgresql://"',
  },
  {
    name: "DIRECT_URL",
    description: "PostgreSQL (conexão direta, usada nas migrations)",
    validate: (v) =>
      /^postgres(ql)?:\/\//.test(v) ? null : 'deveria começar com "postgresql://"',
  },
  {
    name: "JWT_SECRET",
    description: "Segredo do access token",
    validate: minLength(32),
  },
  {
    name: "APP_URL",
    description: "URL pública da aplicação",
    validate: (v) => {
      if (!/^https?:\/\//.test(v)) return 'deveria ser uma URL (http:// ou https://)';
      if (isProd && !v.startsWith("https://")) return "em produção precisa ser https://";
      return null;
    },
  },
  {
    name: "NEXT_PUBLIC_APP_URL",
    description: "URL pública exposta ao browser (precisa existir no build)",
    validate: (v) => {
      if (!/^https?:\/\//.test(v)) return 'deveria ser uma URL (http:// ou https://)';
      if (isProd && !v.startsWith("https://")) return "em produção precisa ser https://";
      return null;
    },
  },
  {
    name: "MERCADOPAGO_ACCESS_TOKEN",
    description: "Token privado do Mercado Pago",
    prodOnly: true,
    validate: startsWith("APP_USR-"),
  },
  {
    name: "MERCADOPAGO_WEBHOOK_SECRET",
    description: "Segredo HMAC do webhook do Mercado Pago",
    prodOnly: true,
    validate: minLength(8),
  },
  {
    name: "NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY",
    description: "Public key do Payment Brick (browser)",
    prodOnly: true,
    validate: startsWith("APP_USR-"),
  },
  {
    name: "RESEND_API_KEY",
    description: "Envio de e-mail transacional",
    prodOnly: true,
    validate: startsWith("re_"),
  },
  {
    name: "EMAIL_FROM",
    description: "Remetente dos e-mails",
    prodOnly: true,
    validate: (v) => (v.includes("@") ? null : "deveria conter um endereço de e-mail"),
  },
  {
    name: "EMAIL_REPLY_TO",
    description: "Endereço de resposta monitorado (opcional, melhora a reputação anti-spam)",
    optional: true,
    validate: (v) => (v.includes("@") ? null : "deveria conter um endereço de e-mail"),
  },
  {
    name: "RESEND_WEBHOOK_SECRET",
    description: "Assinatura do webhook do Resend (bounce/spam) — opcional",
    optional: true,
    validate: startsWith("whsec_"),
  },
  {
    name: "CRON_SECRET",
    description: "Protege /api/cron/billing",
    prodOnly: true,
    validate: minLength(16),
  },
  {
    name: "NEXT_PUBLIC_SUPPORT_WHATSAPP",
    description: "WhatsApp do suporte (DDI+DDD+número)",
    prodOnly: true,
    validate: (v) =>
      /^\d{12,13}$/.test(v.replace(/\D/g, ""))
        ? null
        : "deveria ter 12 ou 13 dígitos (ex.: 5531999990000)",
  },
];

function checkEnv() {
  section("Variáveis de ambiente");
  console.log(`   NODE_ENV = ${process.env.NODE_ENV ?? "(não definido)"}\n`);

  for (const rule of ENV_RULES) {
    const value = process.env[rule.name]?.trim();

    if (!value) {
      const message = `${rule.name} não definida — ${rule.description}`;
      if (rule.optional) advise(message);
      else if (rule.prodOnly && !isProd) advise(`${message} (obrigatória em produção)`);
      else fail(message);
      continue;
    }

    const problem = rule.validate?.(value) ?? null;
    if (problem) fail(`${rule.name} ${problem}`);
    else ok(`${rule.name} — ${rule.description}`);
  }

  // Nomes antigos deixados para trás na migração: se ainda estiverem no
  // ambiente, alguém provavelmente esqueceu de atualizar a Vercel/o CI.
  const RENAMED = {
    MP_ACCESS_TOKEN: "MERCADOPAGO_ACCESS_TOKEN",
    MP_WEBHOOK_SECRET: "MERCADOPAGO_WEBHOOK_SECRET",
    MP_PUBLIC_KEY: "NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY",
    NEXT_PUBLIC_MP_PUBLIC_KEY: "NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY",
    JWT_ACCESS_SECRET: "JWT_SECRET",
    JWT_REFRESH_SECRET: "(removida — o refresh token é opaco, não é JWT)",
  };
  for (const [old, novo] of Object.entries(RENAMED)) {
    if (process.env[old]) advise(`${old} ainda definida — foi renomeada para ${novo}`);
  }
}

// ─────────────────── 2) Banco de dados + 3) resíduo de trial ───────────────────

async function checkDatabase() {
  section("Banco de dados");

  if (!process.env.DATABASE_URL) {
    fail("Sem DATABASE_URL não dá para checar o banco — pulando as verificações.");
    return;
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1`;
    ok("Conexão com o PostgreSQL estabelecida");

    const planosAtivos = await prisma.plan.count({ where: { active: true } });
    if (planosAtivos === 0) fail("Nenhum plano ativo cadastrado — rode o seed antes do deploy");
    else ok(`${planosAtivos} plano(s) ativo(s) cadastrado(s)`);

    await checkPasswordResetFlow(prisma);
    await checkNoTrialResidue(prisma);
  } catch (e) {
    fail(`Falha ao consultar o banco: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Fluxo "esqueci minha senha": o que quebra em produção e não aparece em teste.
 *
 * O envio em si depende de RESEND_API_KEY/EMAIL_FROM (conferidos acima). Aqui
 * checamos o que é específico do banco e do link: o índice do token (senão cada
 * clique em link vira seq scan em users) e tokens vencidos acumulados.
 */
async function checkPasswordResetFlow(prisma) {
  section("Recuperação de senha");

  const [{ count: indice }] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM pg_indexes
    WHERE tablename = 'users' AND indexname = 'users_resetTokenHash_idx'
  `;
  if (indice === 0) {
    fail(
      'Índice "users_resetTokenHash_idx" não existe — rode `prisma migrate deploy` ' +
        "(migration 20260824120000_user_reset_token_index)",
    );
  } else {
    ok('Índice "users_resetTokenHash_idx" presente (busca do token do e-mail)');
  }

  // O link vale 1 hora; token vencido no banco é só resíduo, mas muitos deles
  // sugerem gente pedindo link e não conseguindo usar (e-mail não chegando).
  const vencidos = await prisma.user.count({
    where: { resetTokenHash: { not: null }, resetTokenExpiresAt: { lt: new Date() } },
  });
  if (vencidos > 0) {
    advise(
      `${vencidos} usuário(s) com token de redefinição vencido — normal em pouca ` +
        "quantidade; se for muito, verifique se o e-mail está chegando (painel do Resend)",
    );
  } else {
    ok("Nenhum token de redefinição vencido pendente");
  }

  if (isProd && !process.env.RESEND_API_KEY) {
    fail(
      "Sem RESEND_API_KEY o envio de e-mail é no-op: ninguém consegue recuperar a senha.",
    );
  }
}

/**
 * Garante que o antigo período gratuito não sobreviveu à migração — nem no
 * schema (coluna/enum), nem nos dados (assinatura ativa sem pagamento).
 */
async function checkNoTrialResidue(prisma) {
  section("Resíduo de período gratuito (trial)");

  const [{ count: colunaTrial }] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM information_schema.columns
    WHERE table_name = 'tenant_subscriptions' AND column_name = 'trialEndsAt'
  `;
  if (colunaTrial > 0) fail('A coluna "trialEndsAt" ainda existe — migration não aplicada');
  else ok('Coluna "trialEndsAt" removida');

  const [{ count: valorTrial }] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'SubscriptionStatus' AND e.enumlabel = 'TRIAL'
  `;
  if (valorTrial > 0) fail('O valor "TRIAL" ainda existe no enum SubscriptionStatus');
  else ok('Valor "TRIAL" removido do enum SubscriptionStatus');

  const [{ count: colunaAtivacao }] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM information_schema.columns
    WHERE table_name = 'tenant_subscriptions' AND column_name = 'activatedAt'
  `;
  if (colunaAtivacao === 0) {
    fail('A coluna "activatedAt" não existe — migration não aplicada');
    return;
  }
  ok('Coluna "activatedAt" presente');

  // O caso perigoso: empresa com acesso liberado sem nenhum pagamento aprovado.
  const liberadasSemPagar = await prisma.tenantSubscription.count({
    where: { activatedAt: null, status: { in: ["ATIVO", "VENCIDO"] } },
  });
  if (liberadasSemPagar > 0) {
    fail(
      `${liberadasSemPagar} assinatura(s) com acesso liberado sem nenhum pagamento aprovado ` +
        "(activatedAt nulo) — indica trial residual",
    );
  } else {
    ok("Nenhuma assinatura liberada sem pagamento aprovado");
  }

  const aguardando = await prisma.tenantSubscription.count({ where: { activatedAt: null } });
  if (aguardando > 0) {
    console.log(`   ${aguardando} empresa(s) aguardando o primeiro pagamento (esperado).`);
  }
}

// ─────────────────────────── Execução ───────────────────────────

async function main() {
  console.log(paint(36, "\nCeasaPro — verificação pré-flight"));

  checkEnv();
  await checkDatabase();

  section("Resultado");
  if (warnings.length > 0) console.log(`${paint(33, `${warnings.length} aviso(s)`)}`);

  if (errors.length > 0) {
    console.log(paint(31, `${errors.length} erro(s) — deploy bloqueado:\n`));
    for (const e of errors) console.log(`   • ${e}`);
    console.log("");
    process.exit(1);
  }

  console.log(paint(32, "Tudo certo. Pronto para o deploy.\n"));
}

main().catch((e) => {
  err(`Erro inesperado no pré-flight: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
