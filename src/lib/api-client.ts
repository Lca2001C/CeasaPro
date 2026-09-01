import type { ActionResult } from "@/lib/http/action-result";

/**
 * Está claramente sem rede?
 *
 * `navigator.onLine` só afirma que existe interface de rede — Wi-Fi de portal
 * cativo aparece como "online". Então isto NÃO substitui o tratamento de erro da
 * requisição: serve para o caso barato e certo (rádio desligado, modo avião),
 * onde dá para avisar antes de a pessoa esperar o timeout.
 */
function semRede(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Cliente para chamar Route Handlers das áreas transacionais (vendas, compras...).
 * Retorna o mesmo formato { ok, data | error } das Server Actions.
 *
 * **Nenhuma escrita financeira é enfileirada offline** — é a regra que governa o
 * PWA (ver `docs/10-pwa-evolucao.md`). Venda, compra, pagamento e ajuste dependem
 * de estado que o cliente não conhece sem servidor (saldo de estoque, saldo
 * devedor), e não existe resolução automática correta para o conflito. Guardar para
 * enviar depois criaria a sensação de "está salvo" quando não está, o que é pior
 * que avisar na hora.
 *
 * Por isso a recusa aqui é EXPLÍCITA e imediata, em vez de deixar o `fetch` falhar
 * depois do timeout: a diferença, no balcão, é o cliente esperando.
 */
export async function apiPost<T>(url: string, body: unknown): Promise<ActionResult<T>> {
  if (semRede()) {
    return {
      ok: false,
      error: {
        code: "OFFLINE",
        message:
          "Sem conexão. Este lançamento precisa de internet para ser salvo — nada foi registrado.",
      },
    };
  }
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
  if (semRede()) {
    return {
      ok: false,
      error: {
        code: "OFFLINE",
        message: "Sem conexão. Veja os dados salvos em Consulta offline.",
      },
    };
  }
  try {
    const res = await fetch(url);
    const json = await res.json().catch(() => null);
    if (json && typeof json.ok === "boolean") return json as ActionResult<T>;
    return { ok: false, error: { code: "INTERNAL", message: "Resposta inválida" } };
  } catch {
    return { ok: false, error: { code: "NETWORK", message: "Falha de conexão." } };
  }
}
