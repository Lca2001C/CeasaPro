import { requirePagina } from "@/lib/auth/pagina";

/** Gate do módulo na subárvore inteira — ver o layout de `/cotacoes`. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePagina({ modulo: "ceasanews" });
  return children;
}
