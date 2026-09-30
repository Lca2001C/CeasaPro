import { logger } from "@/lib/logger";

/**
 * Chamada HTTP para fonte externa de boletim.
 *
 * Primeira chamada de rede de saída que o servidor deste projeto faz, então as
 * regras que ela precisa respeitar estão aqui, num lugar só:
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
 * 4. **Respeita o prazo da execução.** Com `prazo` (epoch ms), nenhuma tentativa
 *    passa dele: o tempo limite de cada uma é `min(12 s, restante)`, e retry que
 *    não cabe não é tentado. Sem isto uma fonte pendurada custava 12 + 1 + 12 s
 *    por requisição, e uma central começada com folga "suficiente" estourava o
 *    teto da função serverless — que mata tudo, inclusive o alarme de defasagem
 *    que roda depois da importação.
 */

const TEMPO_LIMITE_MS = 12_000;
const MAX_TENTATIVAS = 2;
const BACKOFF_BASE_MS = 1_000;
/** Menos que isto de sobra não vale abrir conexão: não dá tempo de a fonte responder. */
const MINIMO_POR_TENTATIVA_MS = 1_000;

export interface RespostaHttp {
  ok: boolean;
  corpo: string;
  status?: number;
  erro?: string;
  /**
   * A requisição não terminou porque o PRAZO da execução acabou — não porque a
   * fonte falhou. Quem chama não deve alarmar como quebra da fonte: é "não deu
   * tempo hoje", e a próxima execução pega.
   */
  semTempo?: boolean;
}

export interface OpcoesDeBusca {
  /** Instante (epoch ms) a partir do qual nenhuma requisição pode estar aberta. */
  prazo?: number;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Vale repetir? Rede, tempo esgotado, 429 e 5xx sim; o resto não. */
export function valeRepetir(status: number | undefined, erro: string | undefined): boolean {
  if (status !== undefined) return status === 429 || status >= 500;
  if (!erro) return false;
  return /timeout|abort|network|fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket/i.test(erro);
}

export const ERRO_SEM_TEMPO = "prazo da execução esgotado";

export async function buscarHtml(
  url: string,
  init: RequestInit = {},
  contexto: Record<string, unknown> = {},
  opcoes: OpcoesDeBusca = {},
): Promise<RespostaHttp> {
  let ultimoErro = "";
  let ultimoStatus: number | undefined;
  const restante = () =>
    opcoes.prazo === undefined ? Number.POSITIVE_INFINITY : opcoes.prazo - Date.now();

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    const sobra = restante();
    if (sobra < MINIMO_POR_TENTATIVA_MS) {
      // Na primeira tentativa nada foi pedido: é falta de tempo, não falha. Num
      // retry, a tentativa anterior falhou DE VERDADE, e é esse erro que vale.
      if (tentativa === 1) {
        return { ok: false, corpo: "", erro: ERRO_SEM_TEMPO, semTempo: true };
      }
      return { ok: false, corpo: "", status: ultimoStatus, erro: ultimoErro };
    }
    // Tempo limite encurtado pelo prazo: se ele estourar, a culpa é do relógio
    // da execução, e não da fonte.
    const limite = Math.min(TEMPO_LIMITE_MS, sobra);
    const encurtado = limite < TEMPO_LIMITE_MS;
    try {
      const res = await fetch(url, {
        ...init,
        // Criado AQUI, por tentativa. Ver regra 1 acima.
        signal: AbortSignal.timeout(limite),
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
      if (encurtado && /timeout|abort/i.test(ultimoErro)) {
        logger.warn(
          { ...contexto, url, tentativa, limiteMs: limite },
          "Busca de boletim interrompida pelo prazo da execução",
        );
        return { ok: false, corpo: "", erro: ERRO_SEM_TEMPO, semTempo: true };
      }
      if (!valeRepetir(undefined, ultimoErro) || tentativa === MAX_TENTATIVAS) {
        logger.warn({ ...contexto, url, err: ultimoErro, tentativa }, "Falha ao buscar boletim");
        return { ok: false, corpo: "", erro: ultimoErro };
      }
    }

    const espera = BACKOFF_BASE_MS * 2 ** (tentativa - 1);
    // Retry que não cabe no prazo não é tentado: devolve o erro real agora.
    if (restante() - espera < MINIMO_POR_TENTATIVA_MS) {
      return { ok: false, corpo: "", status: ultimoStatus, erro: ultimoErro };
    }
    await dormir(espera);
  }

  return { ok: false, corpo: "", status: ultimoStatus, erro: ultimoErro };
}
