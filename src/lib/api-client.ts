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
 * Renovação da sessão — em VOO ÚNICO.
 *
 * O access token dura 15 minutos; o refresh token, 30 dias. Só que nada renovava
 * o primeiro automaticamente: quem passava 15 minutos preenchendo uma compra
 * apertava "salvar" e recebia 401 do proxy, perdendo o lançamento inteiro. Era
 * pior no celular, onde digitar é mais lento — mas acontecia em qualquer
 * aparelho.
 *
 * O voo único não é otimização, é correção: `/api/auth/refresh` **rotaciona** o
 * refresh token (revoga o atual e emite outro). Duas renovações em paralelo
 * fariam a segunda apresentar um token que a primeira já revogou, e essa
 * segunda seria recusada — derrubando a sessão justamente ao tentar salvá-la.
 */
let renovacaoEmVoo: Promise<boolean> | null = null;

async function executarRenovacao(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/refresh", { method: "POST" });
    return res.ok;
  } catch {
    return false;
  } finally {
    // Liberado ao terminar: quem chegou durante o voo já recebeu esta mesma
    // promessa, e uma chamada posterior (outro 401) precisa de renovação nova.
    renovacaoEmVoo = null;
  }
}

/** Renova a sessão. `false` = refresh token também inválido (login de novo). */
export function renovarSessao(): Promise<boolean> {
  renovacaoEmVoo ??= executarRenovacao();
  return renovacaoEmVoo;
}

/**
 * Vale tentar renovar a sessão para esta URL?
 *
 * As rotas de `/api/auth` ficam de fora, e não é detalhe: **o login devolve 401
 * para senha errada.** Repetir ali significaria pedir renovação e reenviar o
 * login — gastando o dobro do limite de tentativas e confundindo o diagnóstico
 * de uma senha simplesmente incorreta.
 */
function podeRenovarPara(url: string): boolean {
  return !url.startsWith("/api/auth/");
}

/**
 * Falha antes de haver resposta — e a mensagem precisa ser honesta.
 *
 * "Falha de conexão. Tente novamente." era a mensagem única, e ela MANDA
 * repetir. Só que a requisição pode ter chegado, commitado e só a resposta ter
 * se perdido: repetir registrava a operação de novo. A venda passou a ter chave
 * de idempotência, mas as outras gravações ainda não — então quem não sabe se
 * gravou tem de ser avisado para conferir, não convidado a repetir.
 */
function erroDeRede(e: unknown): { code: string; message: string } {
  const estourouOTempo = e instanceof DOMException && e.name === "TimeoutError";
  return estourouOTempo
    ? {
        code: "TIMEOUT",
        message:
          "O servidor demorou demais para responder. Confira se o lançamento foi registrado antes de tentar de novo.",
      }
    : {
        code: "NETWORK",
        message: "Falha de conexão. Confira se o lançamento foi registrado antes de tentar de novo.",
      };
}

const SESSAO_EXPIRADA = {
  ok: false as const,
  error: {
    code: "UNAUTHORIZED",
    message: "Sua sessão expirou. Entre novamente para continuar.",
  },
};

/**
 * Executa a requisição e, num 401, renova a sessão e tenta UMA vez mais.
 *
 * `jaRenovou` limita a uma repetição: sem isso, um 401 que persiste (conta
 * desativada, por exemplo) viraria laço infinito de renovação.
 */
/**
 * Quanto esperar por uma resposta antes de desistir.
 *
 * Sem teto, um pedido pendurado deixava o operador olhando o botão girar até
 * ele recarregar a página — e recarregar no meio de uma gravação é exatamente
 * como nascia a venda duplicada. Vinte segundos é folgado para a rede do CEASA
 * e curto o bastante para o balcão não parar.
 */
const TEMPO_LIMITE_MS = 20_000;

async function comRenovacao<T>(
  url: string,
  init: RequestInit,
  jaRenovou = false,
): Promise<ActionResult<T>> {
  // O sinal é criado POR TENTATIVA, e não em `init`: herdando o mesmo sinal, a
  // repetição depois do 401 abortaria na hora se o primeiro já tivesse
  // estourado o tempo.
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });

  if (res.status === 401 && !jaRenovou && podeRenovarPara(url)) {
    if (await renovarSessao()) return comRenovacao<T>(url, init, true);
    return SESSAO_EXPIRADA;
  }

  const json = await res.json().catch(() => null);
  if (json && typeof json.ok === "boolean") return json as ActionResult<T>;
  return {
    ok: false,
    error: { code: "INTERNAL", message: "Resposta inválida do servidor" },
  };
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
    return await comRenovacao<T>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Corpo já serializado: pode ser reenviado na repetição sem risco (um
      // `ReadableStream` só poderia ser consumido uma vez).
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: erroDeRede(e) };
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
    return await comRenovacao<T>(url, { method: "GET" });
  } catch {
    return { ok: false, error: { code: "NETWORK", message: "Falha de conexão." } };
  }
}
