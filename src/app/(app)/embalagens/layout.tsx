import { requirePagina } from "@/lib/auth/pagina";

/**
 * Gate de módulo da subárvore inteira.
 *
 * Mora num layout de SEGMENTO, e não em cada página, porque o layout é
 * executado ao entrar na subárvore vindo de fora e cobre tudo que estiver
 * abaixo — inclusive as telas que alguém acrescentar amanhã. Repetir a checagem
 * página a página garantiria que uma delas ficasse de fora.
 *
 * Não sobe para `(app)/layout.tsx`: aquele é o segmento COMUM, e o Next não o
 * reexecuta numa navegação que não cruze o segmento dele — o gate seria
 * avaliado uma vez na entrada do grupo e nunca mais.
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePagina({ modulo: "embalagens" });
  return children;
}
