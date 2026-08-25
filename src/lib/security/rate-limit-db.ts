import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";

/**
 * Rate limit persistido no Postgres — janela fixa, compartilhado entre instâncias.
 *
 * Por que não em memória: em serverless cada request pode ser atendido por uma
 * instância diferente (ou por um processo recém-iniciado), então um contador em
 * processo não segura força bruta no login. O contador vive no banco que a
 * aplicação já usa, sem adicionar fornecedor nem dependência.
 *
 * Use aqui **só** o que precisa resistir a ataque (rotas de autenticação). Para
 * conter abuso acidental por empresa, o contador em memória de `rate-limit.ts`
 * continua sendo a escolha certa: não paga ida ao banco a cada request.
 */

export interface RateLimitResult {
  ok: boolean;
  retryAfterMs: number;
}

/** A chave crua ("login:<ip>:<email>") carrega dado pessoal — só o hash é gravado. */
function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Consome uma unidade da janela e diz se a requisição passa.
 *
 * O incremento é feito num único `INSERT ... ON CONFLICT`, atômico no banco:
 * duas tentativas simultâneas de login não podem ler o mesmo contador e gravar
 * o mesmo valor (que é como um `SELECT` seguido de `UPDATE` perderia contagem).
 *
 * Falha de banco libera a requisição (fail-open) e registra o aviso: as rotas de
 * auth já dependem do banco para qualquer coisa útil, então falhar fechado só
 * trocaria uma indisponibilidade por um erro confuso na tela de login.
 */
export async function rateLimitDb(
  key: string,
  opts: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  const expiresAt = new Date(Date.now() + opts.windowMs);

  try {
    const rows = await prisma.$queryRaw<{ count: number; expiresAt: Date }[]>`
      INSERT INTO "rate_limits" ("keyHash", "count", "expiresAt")
      VALUES (${hashKey(key)}, 1, ${expiresAt})
      ON CONFLICT ("keyHash") DO UPDATE SET
        "count" = CASE
          WHEN "rate_limits"."expiresAt" <= now() THEN 1
          ELSE "rate_limits"."count" + 1
        END,
        "expiresAt" = CASE
          WHEN "rate_limits"."expiresAt" <= now() THEN ${expiresAt}
          ELSE "rate_limits"."expiresAt"
        END
      RETURNING "count", "expiresAt"
    `;

    const row = rows[0];
    if (!row) return { ok: true, retryAfterMs: 0 };

    if (row.count > opts.limit) {
      return { ok: false, retryAfterMs: Math.max(0, row.expiresAt.getTime() - Date.now()) };
    }
    return { ok: true, retryAfterMs: 0 };
  } catch (e) {
    logger.warn(
      { err: e instanceof Error ? e.message : String(e) },
      "Rate limit no banco indisponível — requisição liberada",
    );
    return { ok: true, retryAfterMs: 0 };
  }
}

/**
 * Zera o contador de uma chave.
 *
 * Serve para não punir quem acertou: num limite que existe para conter
 * adivinhação de senha, só a tentativa **malsucedida** deveria consumir a
 * janela. Sem isto, cinco logins corretos em 15 minutos — a mesma pessoa em
 * dois aparelhos, por exemplo — trancariam a conta.
 *
 * Nunca lança: chamado depois que o login já deu certo, e falhar aqui só
 * significa que a janela expira sozinha mais tarde.
 */
export async function resetRateLimit(key: string): Promise<void> {
  try {
    await prisma.rateLimit.deleteMany({ where: { keyHash: hashKey(key) } });
  } catch (e) {
    logger.warn(
      { err: e instanceof Error ? e.message : String(e) },
      "Não foi possível zerar o contador de rate limit",
    );
  }
}

/**
 * Apaga as janelas já vencidas. Chamado pelo cron diário de billing — as linhas
 * expiradas são inertes (a própria consulta as trata como zeradas), então isto
 * é só higiene de tamanho de tabela.
 */
export async function purgeExpiredRateLimits(): Promise<number> {
  const { count } = await prisma.rateLimit.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
