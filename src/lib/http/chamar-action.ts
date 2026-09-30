import type { ActionResult } from "./action-result";

/**
 * Chama uma Server Action do lado do cliente sem deixar a falha de TRANSPORTE
 * virar exceção.
 *
 * O envelope do servidor (`withTenantAction`/`withAdminAction`) só converte o
 * que acontece LÁ. Quando o próprio POST da action falha no aparelho — sinal
 * fraco ("Failed to fetch"), ou o proxy respondendo com redirect para /login
 * ("An unexpected response was received from the server") — a promessa
 * rejeita no cliente. Dentro de `startTransition`, a rejeição sobe para o
 * error boundary e a tela inteira vira "Não conseguimos abrir esta tela",
 * com o texto "seus dados estão salvos" — quando a operação pode ter sido
 * gravada ou não.
 *
 * Aqui a rejeição vira um `ActionResult` com `NETWORK`, e a mesma mensagem que
 * `apiPost` já usa: o componente mostra o toast e a pessoa confere.
 *
 * Só pode ser importado por componente cliente: nada de logger/Prisma aqui.
 */
export async function chamarAction<T>(
  fn: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch {
    return {
      ok: false,
      error: {
        code: "NETWORK",
        message: "Falha de conexão. Confira se a alteração foi registrada antes de tentar de novo.",
      },
    };
  }
}
