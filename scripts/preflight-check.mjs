// Verificação pré-flight do CeasaPro — roda antes da build/deploy.
// Uso: node scripts/preflight-check.mjs   (ou: npm run preflight)
//
// Confere três coisas, nesta ordem:
//   1. Variáveis de ambiente: presença e formato.
//   2. Conexão real com o PostgreSQL e dados mínimos (pelo menos um plano ativo).
//   3. Consistência do teste grátis: ninguém com acesso sem pagamento nem prazo.
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
    name: "SMTP_USER",
    description: "Conta SMTP que envia os e-mails (o endereço Gmail)",
    prodOnly: true,
    validate: (v) => (v.includes("@") ? null : "deveria conter um endereço de e-mail"),
  },
  {
    name: "SMTP_PASSWORD",
    description: "Senha de app do Gmail (a senha da conta NÃO funciona em SMTP)",
    prodOnly: true,
    // A senha de app do Google tem 16 caracteres; às vezes é copiada com espaços.
    validate: (v) =>
      v.replace(/\s/g, "").length >= 16
        ? null
        : "parece curta demais para uma senha de app do Google (16 caracteres)",
  },
  {
    name: "SMTP_HOST",
    description: "Servidor SMTP (opcional; default smtp.gmail.com)",
    optional: true,
  },
  {
    name: "SMTP_PORT",
    description: "Porta SMTP (opcional; default 465)",
    optional: true,
    validate: (v) =>
      ["465", "587", "25", "2525"].includes(v.trim())
        ? null
        : "porta incomum para SMTP (esperado 465 ou 587)",
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
    name: "GOOGLE_CLIENT_ID",
    description: "OAuth Google (login facilitado)",
    optional: true,
  },
  {
    name: "GOOGLE_CLIENT_SECRET",
    description: "Segredo OAuth Google",
    optional: true,
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

  const googleId = process.env.GOOGLE_CLIENT_ID?.trim();
  const googleSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (Boolean(googleId) !== Boolean(googleSecret)) {
    fail("GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET precisam existir juntas (ou nenhuma)");
  }

  // Flags que ABREM uma exceção de segurança. Nenhum é exigido, e o padrão de
  // ambos é o seguro — o risco é ligar para depurar e esquecer de desligar.
  // Nada no sistema avisava: o cookie de sessão simplesmente perdia o `Secure`,
  // e o CSP simplesmente deixava de bloquear.
  const FLAGS_PERIGOSOS = [
    {
      name: "ALLOW_INSECURE_COOKIES",
      efeito:
        "o cookie de sessão é gravado SEM `Secure` — qualquer rede no caminho lê a sessão",
      porque: "existe para testar na LAN por IP (http://192.168.x.x), onde o navegador não considera a origem segura",
    },
    {
      name: "CSP_REPORT_ONLY",
      efeito: "o Content-Security-Policy é publicado mas NÃO é aplicado — XSS deixa de ser bloqueado",
      porque: "existe para observar violações antes de endurecer uma diretiva",
    },
  ];
  for (const flag of FLAGS_PERIGOSOS) {
    if (process.env[flag.name] !== "1") continue;
    const msg = `${flag.name}=1 — ${flag.efeito}. ${flag.porque}.`;
    if (isProd) fail(`${msg} NÃO pode ficar ligado em produção.`);
    else advise(msg);
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
    await checkTrialConsistency(prisma);
  } catch (e) {
    fail(`Falha ao consultar o banco: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Fluxo "esqueci minha senha": o que quebra em produção e não aparece em teste.
 *
 * O envio em si depende de SMTP_USER/SMTP_PASSWORD/EMAIL_FROM (conferidos acima). Aqui
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
        "quantidade; se for muito, verifique se o e-mail está chegando (caixa de enviados do Gmail)",
    );
  } else {
    ok("Nenhum token de redefinição vencido pendente");
  }

  if (isProd && !(process.env.SMTP_USER && process.env.SMTP_PASSWORD)) {
    fail(
      "Sem SMTP_USER/SMTP_PASSWORD o envio de e-mail é no-op: ninguém consegue recuperar a senha.",
    );
  }
}

/**
 * Consistência do teste grátis de 7 dias.
 *
 * Esta função antes garantia o OPOSTO — que o período gratuito não existia — e
 * falhava se `trialEndsAt` ou o valor `TRIAL` estivessem presentes. Com a
 * reintrodução do teste (migration `20260831120000`) ela foi invertida no que diz
 * respeito ao schema, mas o invariante de negócio que ela realmente protege está
 * intacto e é o mesmo:
 *
 *   **ninguém tem acesso liberado sem pagamento aprovado OU teste válido.**
 *
 * A diferença é que agora existem dois caminhos legítimos, e cada um tem sua
 * prova: `activatedAt` para quem pagou, `trialEndsAt` no futuro para quem testa.
 */
async function checkTrialConsistency(prisma) {
  section("Consistência do teste grátis (trial)");

  // Mesmo motivo do índice do token de senha: a confirmação busca o usuário PELO
  // hash do token, em rota pública. Sem índice, cada clique em link de
  // confirmação vira varredura completa de `users`.
  const [{ count: indiceVerify }] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM pg_indexes
    WHERE tablename = 'users' AND indexname = 'users_verifyTokenHash_idx'
  `;
  if (indiceVerify === 0) {
    fail(
      'Índice "users_verifyTokenHash_idx" não existe — rode `prisma migrate deploy` ' +
        "(migration 20260831120000_add_trial_and_public_signup)",
    );
  } else {
    ok('Índice "users_verifyTokenHash_idx" presente (busca do token de confirmação)');
  }

  const [{ count: colunaTrial }] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM information_schema.columns
    WHERE table_name = 'tenant_subscriptions' AND column_name = 'trialEndsAt'
  `;
  if (colunaTrial === 0) {
    fail('A coluna "trialEndsAt" não existe — migration não aplicada');
    return;
  }
  ok('Coluna "trialEndsAt" presente');

  const [{ count: valorTrial }] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'SubscriptionStatus' AND e.enumlabel = 'TRIAL'
  `;
  if (valorTrial === 0) {
    fail('O valor "TRIAL" não existe no enum SubscriptionStatus — migration não aplicada');
    return;
  }
  ok('Valor "TRIAL" presente no enum SubscriptionStatus');

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

  // Caso perigoso 1: ATIVO/VENCIDO exigem pagamento aprovado. Continua valendo.
  const liberadasSemPagar = await prisma.tenantSubscription.count({
    where: { activatedAt: null, status: { in: ["ATIVO", "VENCIDO"] } },
  });
  if (liberadasSemPagar > 0) {
    fail(
      `${liberadasSemPagar} assinatura(s) marcada(s) como ATIVO/VENCIDO sem nenhum pagamento ` +
        "aprovado (activatedAt nulo) — esses status pressupõem pagamento",
    );
  } else {
    ok("Nenhuma assinatura ATIVO/VENCIDO sem pagamento aprovado");
  }

  // Caso perigoso 2 (novo): TRIAL sem data de fim é acesso liberado sem prazo.
  // `accessDecision` devolve "ok" para TRIAL, então uma linha assim é uso grátis
  // indefinido até o próximo recálculo — que talvez nunca aconteça se o cron
  // parar. Vale falhar o preflight.
  const trialSemPrazo = await prisma.tenantSubscription.count({
    where: { status: "TRIAL", trialEndsAt: null },
  });
  if (trialSemPrazo > 0) {
    fail(
      `${trialSemPrazo} assinatura(s) em TRIAL sem "trialEndsAt" — acesso liberado sem prazo`,
    );
  } else {
    ok('Nenhuma assinatura em TRIAL sem prazo de fim');
  }

  // Caso perigoso 3 (novo): TRIAL já vencido que ainda não foi recalculado.
  // Não é falha de deploy (o cron e o refresh corrigem), mas precisa aparecer:
  // em volume, indica que o recálculo parou de rodar.
  const trialVencidoNaoRecalculado = await prisma.tenantSubscription.count({
    where: { status: "TRIAL", activatedAt: null, trialEndsAt: { lt: new Date() } },
  });
  if (trialVencidoNaoRecalculado > 0) {
    advise(
      `${trialVencidoNaoRecalculado} assinatura(s) em TRIAL com prazo vencido aguardando ` +
        "recálculo (cron de billing / refresh de sessão)",
    );
  }

  const emTeste = await prisma.tenantSubscription.count({
    where: { status: "TRIAL", trialEndsAt: { gte: new Date() } },
  });
  if (emTeste > 0) {
    console.log(`   ${emTeste} empresa(s) em teste grátis (esperado).`);
  }

  const aguardando = await prisma.tenantSubscription.count({
    where: { activatedAt: null, trialEndsAt: null },
  });
  if (aguardando > 0) {
    console.log(
      `   ${aguardando} empresa(s) aguardando o primeiro pagamento ou a confirmação de e-mail (esperado).`,
    );
  }
}

// ─────────────────────────── Execução ───────────────────────────

/**
 * Autentica no SMTP sem enviar nada (comando VRFY/NOOP do handshake).
 *
 * É a única checagem que pega senha de app errada, verificação em duas etapas
 * desligada ou porta bloqueada — coisas que só apareceriam quando um cliente
 * pedisse "esqueci minha senha" e o e-mail não chegasse.
 */
async function checkSmtp() {
  section("E-mail (SMTP)");

  // ── Entrega na caixa de entrada ──
  // Autenticar no SMTP prova que o e-mail SAI, não que ele CHEGA. O que decide
  // caixa de entrada × spam é o remetente: domínio próprio, autenticado e
  // coerente com os links do corpo. Estes avisos existem porque o sintoma
  // ("caiu no spam") não aponta a causa, e a causa quase nunca está no código.
  const remetente = process.env.EMAIL_FROM ?? "";
  const dominioDe = (v) => {
    const m = String(v).match(/@([^>s]+)/);
    return m ? m[1].toLowerCase().replace(/[>,;]+$/, "") : null;
  };
  const domFrom = dominioDe(remetente);
  const domSmtp = dominioDe(process.env.SMTP_USER ?? "");
  const GRATUITOS = new Set([
    "gmail.com", "googlemail.com", "hotmail.com", "outlook.com",
    "live.com", "yahoo.com", "yahoo.com.br", "icloud.com", "bol.com.br", "uol.com.br",
  ]);

  if (domFrom && GRATUITOS.has(domFrom)) {
    advise(
      `EMAIL_FROM usa um provedor GRATUITO (${domFrom}). E-mail transacional com nome ` +
        "de marca saindo de conta gratuita é fortemente penalizado pelos filtros — é a " +
        "causa mais provável de cair no spam. Envie de um domínio próprio " +
        "(ex.: nao-responda@ceasapro.com.br) com SPF, DKIM e DMARC publicados no DNS.",
    );
  }

  if (domFrom && domSmtp && domFrom !== domSmtp) {
    advise(
      `EMAIL_FROM (${domFrom}) e SMTP_USER (${domSmtp}) são de domínios diferentes. ` +
        "O Gmail REESCREVE o remetente para a conta autenticada, a menos que o endereço " +
        "esteja verificado em Gmail › Ver todas as configurações › Contas › " +
        "\"Enviar e-mail como\". Sem isso, o From que chega não é o configurado.",
    );
  }

  const domApp = (() => {
    try { return new URL(process.env.APP_URL ?? "").hostname.replace(/^www./, "").toLowerCase(); }
    catch { return null; }
  })();
  if (domFrom && domApp && domApp !== "localhost" && !domFrom.endsWith(domApp)) {
    advise(
      `O remetente (${domFrom}) não pertence ao domínio da aplicação (${domApp}). ` +
        "Divergência entre o From e os links do corpo é sinal de phishing para os " +
        "filtros, e derruba a entrega mesmo com SPF/DKIM válidos.",
    );
  }

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!user || !pass) {
    if (isProd) fail("SMTP_USER/SMTP_PASSWORD ausentes — nenhum e-mail sairá.");
    else advise("SMTP não configurado — envio será no-op (normal em desenvolvimento)");
    return;
  }

  let nodemailer;
  try {
    ({ default: nodemailer } = await import("nodemailer"));
  } catch {
    fail("Pacote `nodemailer` não instalado — rode `npm install`.");
    return;
  }

  const port = Number(process.env.SMTP_PORT ?? "465");
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  });

  try {
    await transporter.verify();
    ok(`Autenticação SMTP bem-sucedida (${user})`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/invalid login|username and password not accepted|535/i.test(msg)) {
      fail(
        "SMTP recusou as credenciais. No Gmail é preciso uma SENHA DE APP " +
          "(Conta Google › Segurança › Verificação em duas etapas › Senhas de app) — " +
          "a senha normal da conta não autentica.",
      );
    } else if (/timeout|ETIMEDOUT|ECONNREFUSED/i.test(msg)) {
      fail(
        `Não foi possível conectar em ${process.env.SMTP_HOST ?? "smtp.gmail.com"}:${port} — ` +
          "porta bloqueada pela rede? (comum em rede corporativa)",
      );
    } else {
      fail(`Falha ao verificar o SMTP: ${msg}`);
    }
  } finally {
    transporter.close();
  }
}

async function main() {
  console.log(paint(36, "\nCeasaPro — verificação pré-flight"));

  checkEnv();
  await checkDatabase();
  await checkSmtp();

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
