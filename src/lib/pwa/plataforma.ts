/**
 * Plataforma do aparelho, do ponto de vista da INSTALAÇÃO do PWA.
 *
 * O caminho para colocar o app na tela inicial é diferente em cada plataforma, e
 * errar aqui manda o comerciante procurar um item de menu que não existe no
 * aparelho dele — o pior desfecho possível para um convite de instalação.
 *
 * As funções recebem o user agent por parâmetro em vez de ler `navigator`: é o
 * que permite cobrir com teste os user agents reais de iPhone, Chrome no iPhone,
 * iPad e Android, sem subir um navegador para cada caso.
 *
 * Ver `docs/10-pwa-evolucao.md` para os limites do iOS.
 */

export type Plataforma =
  /** Safari no iPhone/iPad: só existe o passo a passo manual (Compartilhar → Adicionar). */
  | "ios-safari"
  /** Chrome/Firefox/Edge no iPhone: nem passo a passo existe; o caminho é abrir no Safari. */
  | "ios-outro"
  /** Android, desktop: a instalação é nativa e depende de `beforeinstallprompt`. */
  | "outro";

/**
 * No iOS todo navegador roda sobre o motor do Safari, mas só o Safari oferece
 * "Adicionar à Tela de Início" com suporte a PWA. Estes se anunciam no user agent
 * com um sufixo próprio.
 */
const NAVEGADORES_SEM_INSTALACAO_NO_IOS = /CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|DuckDuckGo/;

export function ehIOS(ua: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ se identifica como Macintosh; o toque é o que o distingue de um Mac.
  return /Macintosh/.test(ua) && maxTouchPoints > 1;
}

export function detectarPlataforma(ua: string, maxTouchPoints: number): Plataforma {
  if (!ehIOS(ua, maxTouchPoints)) return "outro";
  return NAVEGADORES_SEM_INSTALACAO_NO_IOS.test(ua) ? "ios-outro" : "ios-safari";
}

/**
 * Plataforma do navegador atual. No servidor devolve `"outro"`, o valor que não
 * mostra passo a passo nenhum — o HTML do servidor nunca deve afirmar em qual
 * aparelho o usuário está.
 */
export function plataformaAtual(): Plataforma {
  if (typeof navigator === "undefined") return "outro";
  return detectarPlataforma(navigator.userAgent, navigator.maxTouchPoints);
}

/** A plataforma não muda no meio da sessão: assinatura vazia, de propósito. */
export const semMudanca = () => () => {};

/** O app está aberto como app instalado, e não numa aba do navegador? */
export function estaInstalado(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // iOS antigo não expõe display-mode; `standalone` é o sinal dele.
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Assina as duas formas de o app "virar instalado" durante a sessão: a mudança do
 * display-mode e o evento `appinstalled`. Sem isto o convite continuaria aberto
 * depois de o usuário instalar.
 */
export function assinarInstalado(notificar: () => void): () => void {
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", notificar);
  window.addEventListener("appinstalled", notificar);
  return () => {
    mq.removeEventListener("change", notificar);
    window.removeEventListener("appinstalled", notificar);
  };
}
