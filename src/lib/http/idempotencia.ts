/**
 * A violação de unicidade é a do índice `(tenantId, idempotencyKey)`?
 *
 * Conferir o ALVO importa: tratar qualquer P2002 como "já gravado" devolveria
 * sucesso para um lançamento que na verdade foi recusado por outro motivo.
 */
export function ehConflitoDeIdempotencia(e: unknown): boolean {
  const err = e as { code?: unknown; meta?: { target?: unknown } } | null;
  if (err?.code !== "P2002") return false;
  const alvo = err.meta?.target;
  if (typeof alvo === "string") return alvo.endsWith("_idempotencyKey_key");
  return Array.isArray(alvo) && alvo.map(String).includes("idempotencyKey");
}

/**
 * Roda `gravar`; se a chave já existe (agora ou numa corrida), devolve o que
 * `buscar` encontrar pela chave. Sem chave, só grava.
 */
export async function comIdempotencia<T>(
  chave: string | null | undefined,
  buscar: (chave: string) => Promise<T | null>,
  gravar: () => Promise<T>,
): Promise<T> {
  if (!chave) return gravar();
  const anterior = await buscar(chave);
  if (anterior) return anterior;
  try {
    return await gravar();
  } catch (e) {
    if (ehConflitoDeIdempotencia(e)) {
      const gravado = await buscar(chave);
      if (gravado) return gravado;
    }
    throw e;
  }
}
