import { logger } from "@/lib/logger";

/**
 * Chamada HTTP para fonte externa de boletim.
 *
 * Primeira chamada de rede de saída que o servidor deste projeto faz, então as
 * três regras que ela precisa respeitar estão aqui, num lugar só:
 *
 * 1. **Tempo limite POR TENTATIVA.** `AbortSignal.timeout` é criado dentro do
 *    laço, nunca reaproveitado — herdar o mesmo sinal faria a segunda tentativa
 *    abortar na hora se a primeira já tivesse estourado o tempo. É o mesmo
 *    cuidado documentado em `api-client.ts`.
 * 2. **Retry só do que vale a pena repetir.** Rede caindo, tempo esgotado, 429 e
 *    5xx voltam; 4xx não, porque repetir não muda o resultado e só bate no
 *    servidor de terceiro. Mesma separação de `isRetriableSmtpError`.
 * 3. **Nunca lança para o chamador.** Devolve `{ ok, ... }` — o cron precisa
 *    seguir para a próxima central mesmo quando uma falha.
 */

const TEMPO_LIMITE_MS = 25_000;
const MAX_TENTATIVAS = 3;
const BACKOFF_BASE_MS = 1_000;

export interface RespostaHttp {
  ok: boolean;
  corpo: string;
  status?: number;
  erro?: string;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Vale repetir? Rede, tempo esgotado, 429 e 5xx sim; o resto não. */
export function valeRepetir(status: number | undefined, erro: string | undefined): boolean {
  if (status !== undefined) return status === 429 || status >= 500;
  if (!erro) return false;
  return /timeout|abort|network|fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket/i.test(erro);
}

export async function buscarHtml(
  url: string,
  init: RequestInit = {},
  contexto: Record<string, unknown> = {},
): Promise<RespostaHttp> {
  let ultimoErro = "";
  let ultimoStatus: number | undefined;

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      const res = await fetch(url, {
        ...init,
        // Criado AQUI, por tentativa. Ver regra 1 acima.
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
        headers: {
          // Sem User-Agent, alguns servidores legados devolvem 403 ou HTML
          // diferente. Identificar o robô também é o mínimo de educação com um
          // serviço público que não nos deve nada.
          "User-Agent": "CeasaProBot/1.0 (+https://ceasapro.com.br)",
          "Accept-Language": "pt-BR,pt;q=0.9",
          ...(init.headers ?? {}),
        },
      });
      ultimoStatus = res.status;

      if (!res.ok) {
        ultimoErro = `HTTP ${res.status}`;
        if (!valeRepetir(res.status, undefined) || tentativa === MAX_TENTATIVAS) {
          return { ok: false, corpo: "", status: res.status, erro: ultimoErro };
        }
      } else {
        return { ok: true, corpo: await res.text(), status: res.status };
      }
    } catch (e) {
      ultimoErro = e instanceof Error ? e.message : String(e);
      ultimoStatus = undefined;
      if (!valeRepetir(undefined, ultimoErro) || tentativa === MAX_TENTATIVAS) {
        logger.warn({ ...contexto, url, err: ultimoErro, tentativa }, "Falha ao buscar boletim");
        return { ok: false, corpo: "", erro: ultimoErro };
      }
    }

    await dormir(BACKOFF_BASE_MS * 2 ** (tentativa - 1));
  }

  return { ok: false, corpo: "", status: ultimoStatus, erro: ultimoErro };
}
