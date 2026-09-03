/**
 * Estado do tour guiado.
 *
 * Duas coisas diferentes vivem aqui, e é de propósito que uma NÃO seja
 * persistida e a outra seja:
 *
 * - **Onde o tour está agora** (`posicao`) fica só na memória do módulo. O tour
 *   atravessa navegações, e o layout do app não é remontado entre elas — então
 *   a memória do módulo basta, sem sessionStorage. Recarregar a página encerra o
 *   tour, o que é o comportamento certo: ninguém espera um balão aparecer
 *   sozinho depois de reabrir o app.
 *
 * - **Se a pessoa já foi convidada** fica no `localStorage`. É o que impede o
 *   convite do Início de reaparecer todo dia para quem já resolveu a questão.
 *
 * O estado é lido com `useSyncExternalStore` (mesmo caminho do convite de
 * instalação do PWA): é fonte externa ao React, compartilhada por componentes
 * sem relação de pai e filho — o motor do tour está no layout do app, e os
 * botões que o disparam estão nas páginas.
 */
import { ROTA_INICIAL } from "./roteiro";

// ─────────────────── Onde o tour está agora ───────────────────

export interface PosicaoTour {
  /** Tela do capítulo em curso. */
  rota: string;
  /**
   * Em que ponto entrar no capítulo. `"ultimo"` é o que faz o botão Voltar
   * atravessar telas de forma coerente: voltar de /compras cai no ÚLTIMO balão
   * de /produtos, e não no primeiro (que obrigaria a reler a tela toda).
   */
  entrada: "primeiro" | "ultimo";
}

/**
 * Guardado como objeto único e substituído por inteiro a cada mudança.
 *
 * A identidade importa: `useSyncExternalStore` compara o snapshot por
 * referência, e devolver um objeto novo a cada leitura faria o React re-renderizar
 * sem parar.
 */
let posicao: PosicaoTour | null = null;
const ouvintes = new Set<() => void>();

function mover(nova: PosicaoTour | null) {
  posicao = nova;
  for (const ouvinte of ouvintes) ouvinte();
}

export function assinarTour(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function lerPosicao(): PosicaoTour | null {
  return posicao;
}

/** Snapshot do servidor: no HTML renderizado o tour nunca está em andamento. */
export const tourParado = () => null;

/**
 * Começa do início. Também marca o convite como respondido: quem já entrou no
 * tour não precisa ser convidado de novo, nem se sair no meio.
 */
export function iniciarTour() {
  marcarConvidado();
  mover({ rota: ROTA_INICIAL, entrada: "primeiro" });
}

/** Leva o tour para outra tela do roteiro (avançando ou voltando). */
export function irParaTela(rota: string, entrada: PosicaoTour["entrada"]) {
  mover({ rota, entrada });
}

export function encerrarTour() {
  if (posicao === null) return;
  mover(null);
}

// ─────────────────── Memória do convite ───────────────────

const CHAVE_CONVIDADO = "tour-convidado-em";

export function marcarConvidado() {
  try {
    localStorage.setItem(CHAVE_CONVIDADO, String(Date.now()));
    convidadoCache = true;
  } catch {
    // Armazenamento bloqueado (aba privada, política do aparelho): sem memória
    // o convite pode reaparecer. Preferível a não conseguir convidar ninguém.
  }
}

/**
 * Lido UMA vez por carregamento de página e cacheado.
 *
 * O cache é o que mantém o snapshot estável: `useSyncExternalStore` relê o
 * getSnapshot a cada render, e se ele voltasse ao storage a cada leitura, o
 * valor poderia mudar no meio de um ciclo de render. Quem dispensa o convite
 * some por estado local do componente, não por esta leitura.
 */
let convidadoCache: boolean | null = null;

export function jaFoiConvidado(): boolean {
  if (convidadoCache === null) {
    try {
      convidadoCache = localStorage.getItem(CHAVE_CONVIDADO) !== null;
    } catch {
      // Sem storage não há como saber; não insistir é o lado seguro do erro.
      convidadoCache = true;
    }
  }
  return convidadoCache;
}

/** No servidor: considerado convidado, para o HTML nunca trazer o convite. */
export const convidadoNoServidor = () => true;

/**
 * A memória do convite não muda sozinha durante a sessão: assinatura vazia, de
 * propósito.
 */
export const semMudanca = () => () => {};
