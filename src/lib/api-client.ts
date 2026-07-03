import type { ActionResult } from "@/lib/http/action-result";

/**
 * Cliente para chamar Route Handlers das áreas transacionais (vendas, compras...).
 * Retorna o mesmo formato { ok, data | error } das Server Actions.
 */
export async function apiPost<T>(url: string, body: unknown): Promise<ActionResult<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (json && typeof json.ok === "boolean") return json as ActionResult<T>;
    return {
      ok: false,
      error: { code: "INTERNAL", message: "Resposta inválida do servidor" },
    };
  } catch {
    return {
      ok: false,
      error: { code: "NETWORK", message: "Falha de conexão. Tente novamente." },
    };
  }
}

export async function apiGet<T>(url: string): Promise<ActionResult<T>> {
  try {
    const res = await fetch(url);
    const json = await res.json().catch(() => null);
    if (json && typeof json.ok === "boolean") return json as ActionResult<T>;
    return { ok: false, error: { code: "INTERNAL", message: "Resposta inválida" } };
  } catch {
    return { ok: false, error: { code: "NETWORK", message: "Falha de conexão." } };
  }
}
