const BASE = "https://ceasapro.local";

/**
 * Caminho interno seguro para redirecionar, ou `fallback`.
 *
 * A checagem vale para o RESULTADO, não só para a entrada: o parser de URL
 * normaliza ponto-segmento, e `/.//evil.com` (ou `/..//x`, `/%2e//x`,
 * `/a/..//x`) passa em qualquer teste feito na string crua mas sai como
 * `//evil.com` — caminho protocolo-relativo, que o navegador segue para outro
 * host. Por isso o valor devolvido é conferido de novo, e a função é
 * idempotente: aplicá-la duas vezes dá o mesmo que aplicá-la uma.
 */
export function safeRedirectPath(
  value: string | null | undefined,
  fallback: string,
): string {
  const candidate = value?.trim();
  if (!candidate) return fallback;
  if (!ehCaminhoLocal(candidate)) return fallback;

  try {
    const url = new URL(candidate, BASE);
    if (url.origin !== BASE) return fallback;
    if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return fallback;
    const resultado = `${url.pathname}${url.search}${url.hash}`;
    if (!ehCaminhoLocal(resultado)) return fallback;
    return resultado;
  } catch {
    return fallback;
  }
}

/**
 * Começa com UMA barra, sem `//` nem `/\` no início, sem barra invertida e sem
 * caractere de controle (o parser de URL descarta tab/quebra de linha, o que
 * junta barras que pareciam separadas).
 */
function ehCaminhoLocal(caminho: string): boolean {
  if (!caminho.startsWith("/")) return false;
  if (caminho.startsWith("//")) return false;
  if (caminho.includes("\\")) return false;
  if (/[\u0000-\u001f\u007f]/.test(caminho)) return false;
  return true;
}
