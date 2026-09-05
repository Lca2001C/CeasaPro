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
  /**
   * O contador não pôde ser consultado (banco indisponível).
   *
   * A requisição é recusada do mesmo jeito — mas quem responde precisa saber a
   * diferença: "muitas tentativas" (429) culpa o cliente por um problema nosso
   * e gera chamado de suporte; o certo aqui é 503.
   */
  indisponivel?: boolean;
}

/**
 * Resposta padrão quando o contador recusa.
 *
 * Distinguir os dois casos importa para quem está do outro lado: 429 "muitas
 * tentativas" é uma acusação, e usá-la quando o banco caiu manda a pessoa
 * esperar 15 minutos por um problema que é nosso e dura segundos.
 */
export function respostaDeLimite(rl: RateLimitResult): Response {
  if (rl.indisponivel) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Sistema temporariamente indisponível. Tente de novo em instantes.",
        },
      },
      { status: 503, headers: { "Retry-After": "2" } },
    );
  }
  return Response.json(
    {
      ok: false,
      error: {
        code: "RATE_LIMIT",
        message: "Muitas tentativas. Tente novamente em alguns minutos.",
      },
    },
    { status: 429 },
  );
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
 * Falha de banco RECUSA a requisição (fail-closed), depois de uma retentativa.
 *
 * Era o contrário, e o argumento escrito era: "as rotas de auth já dependem do
 * banco para qualquer coisa útil, então falhar fechado só trocaria uma
 * indisponibilidade por um erro confuso". O raciocínio vale para `/login` — que
 * de fato não faz nada sem banco — mas a conclusão não se sustenta: TODAS as
 * janelas de autenticação vivem nesta função, então um único incidente de
 * Postgres desligava ao mesmo tempo o limite de login, de recuperação de senha,
 * de cadastro, de reset e de troca de senha. Pior: `rateLimitDb` faz duas
 * consultas por tentativa de login, então saturar o pool é barato — e quem
 * conseguisse fazê-lo ganhava força bruta ilimitada como efeito colateral, com
 * um `warn` no meio do log como único sinal.
 *
 * A retentativa curta cobre o caso comum e barato (esgotamento momentâneo do
 * pool no Neon) sem deixar o fail-closed virar indisponibilidade por soluço.
 */
export async function rateLimitDb(
  key: string,
  opts: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  try {
    return await consumirJanela(key, opts);
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }

  try {
    return await consumirJanela(key, opts);
  } catch (e) {
    logger.error(
      { err: e instanceof Error ? e.message : String(e) },
      "Rate limit no banco indisponível — requisição RECUSADA (fail-closed)",
    );
    return { ok: false, retryAfterMs: 1000, indisponivel: true };
  }
}

async function consumirJanela(
  key: string,
  opts: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  const expiresAt = new Date(Date.now() + opts.windowMs);

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
