/**
 * Tema da interface: Claro, Escuro ou Automático (segue o aparelho).
 *
 * A escolha é do APARELHO, não da conta — fica no `localStorage`, como o
 * celular do balcão e o computador do escritório podem querer coisas
 * diferentes. Sem escolha salva, vale "automático".
 *
 * Aplicada em dois momentos:
 *  1. Antes da primeira pintura, pelo `SCRIPT_DO_TEMA` inline no `<head>`
 *     (ver `app/layout.tsx`) — sem ele a tela piscaria branca antes de ficar
 *     escura.
 *  2. Depois, em tempo de uso, por `aplicarTema` (troca no seletor, ou o
 *     sistema mudando de claro para escuro com o app aberto em "automático").
 *
 * Sem imports: roda no servidor (só as constantes) e no navegador.
 */

export type Tema = "claro" | "escuro" | "auto";

export const TEMAS: readonly Tema[] = ["claro", "escuro", "auto"];

export const ROTULO_DO_TEMA: Record<Tema, string> = {
  claro: "Claro",
  escuro: "Escuro",
  auto: "Automático",
};

export const CHAVE_DO_TEMA = "ceasapro-tema";

/** Cor da barra do navegador / do sistema em cada tema (`<meta name="theme-color">`). */
export const COR_DA_BARRA = { claro: "#FFFFFF", escuro: "#071426" } as const;

/** Evento disparado nesta aba quando o tema muda (o `storage` só avisa as OUTRAS abas). */
export const EVENTO_DO_TEMA = "ceasapro:tema";

const CONSULTA_ESCURO = "(prefers-color-scheme: dark)";

export function ehTema(v: unknown): v is Tema {
  return v === "claro" || v === "escuro" || v === "auto";
}

/**
 * O script que roda no `<head>` antes de qualquer pintura.
 *
 * Escrito à mão e mínimo (é texto dentro do HTML de toda página), e com
 * `try/catch`: `localStorage` pode não existir (aba anônima com armazenamento
 * bloqueado) e isso não pode quebrar a página — cai no automático.
 */
export const SCRIPT_DO_TEMA = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  CHAVE_DO_TEMA,
)});var e=t===${JSON.stringify("escuro")}||(t!==${JSON.stringify(
  "claro",
)}&&window.matchMedia(${JSON.stringify(
  CONSULTA_ESCURO,
)}).matches);var d=document.documentElement;d.classList.toggle("dark",e);d.style.colorScheme=e?"dark":"light"}catch(_){}})()`;

export function lerTema(): Tema {
  try {
    const v = window.localStorage.getItem(CHAVE_DO_TEMA);
    return ehTema(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

export function sistemaEscuro(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.(CONSULTA_ESCURO).matches === true;
}

/** Aplica o tema no `<html>` e na cor da barra do sistema. */
export function aplicarTema(tema: Tema): void {
  const escuro = tema === "escuro" || (tema === "auto" && sistemaEscuro());
  const raiz = document.documentElement;
  raiz.classList.toggle("dark", escuro);
  raiz.style.colorScheme = escuro ? "dark" : "light";
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    // Em "automático" cada meta volta à sua faixa (`media`); escolhido à mão,
    // as duas passam a dizer a cor do tema escolhido — senão o sistema claro
    // pintaria a barra de branco sobre o app escuro.
    const daFaixaEscura = (meta.getAttribute("media") ?? "").includes("dark");
    const cor =
      tema === "auto"
        ? daFaixaEscura
          ? COR_DA_BARRA.escuro
          : COR_DA_BARRA.claro
        : escuro
          ? COR_DA_BARRA.escuro
          : COR_DA_BARRA.claro;
    meta.setAttribute("content", cor);
  }
}

export function salvarTema(tema: Tema): void {
  try {
    window.localStorage.setItem(CHAVE_DO_TEMA, tema);
  } catch {
    // Armazenamento bloqueado: vale só nesta visita.
  }
  aplicarTema(tema);
  window.dispatchEvent(new Event(EVENTO_DO_TEMA));
}

/** Para `useSyncExternalStore`: avisa quando o tema muda (aqui, em outra aba ou no sistema). */
export function assinarTema(avisar: () => void): () => void {
  const mq = window.matchMedia?.(CONSULTA_ESCURO);
  const aoMudarSistema = () => {
    if (lerTema() === "auto") aplicarTema("auto");
    avisar();
  };
  const aoMudarArmazenamento = (e: StorageEvent) => {
    if (e.key !== CHAVE_DO_TEMA) return;
    aplicarTema(lerTema());
    avisar();
  };
  window.addEventListener(EVENTO_DO_TEMA, avisar);
  window.addEventListener("storage", aoMudarArmazenamento);
  mq?.addEventListener("change", aoMudarSistema);
  return () => {
    window.removeEventListener(EVENTO_DO_TEMA, avisar);
    window.removeEventListener("storage", aoMudarArmazenamento);
    mq?.removeEventListener("change", aoMudarSistema);
  };
}
