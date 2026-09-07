import { requirePagina } from "@/lib/auth/pagina";

/**
 * Gate de módulo da subárvore inteira.
 *
 * Mora num layout de SEGMENTO, e não em cada página, porque o layout é
 * executado ao entrar na subárvore vindo de fora e cobre tudo que estiver
 * abaixo — inclusive as telas que alguém acrescentar amanhã. Repetir a checagem
 * página a página garantiria que uma delas ficasse de fora.
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePagina({ modulo: "cotacoes" });
  return children;
}
