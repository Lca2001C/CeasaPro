import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

// Argon2id (padrão OWASP). Só roda em Node runtime (não Edge).
const OPTS = {
  memoryCost: 19456, // ~19 MB
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTS);
}

export async function verifyPassword(
  hashed: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

let iscaCache: Promise<string> | null = null;

/**
 * Hash descartável, com os MESMOS parâmetros do real.
 *
 * Serve para gastar o mesmo tempo de CPU quando o e-mail não existe. Sem isto, o
 * login respondia na hora para e-mail inexistente e só rodava o Argon2 (~19 MB,
 * dezenas a centenas de ms) quando a conta existia — diferença estável e
 * mensurável de fora, que revela quais contas existem apesar da mensagem de erro
 * ser genérica. Verificar contra a isca iguala o custo dos dois caminhos.
 *
 * O valor é sorteado uma vez por processo e memoizado: nenhuma senha real bate
 * com ele, e o custo de gerá-lo é pago só na primeira chamada.
 */
export function hashDeIsca(): Promise<string> {
  iscaCache ??= hashPassword(randomBytes(32).toString("hex"));
  return iscaCache;
}
