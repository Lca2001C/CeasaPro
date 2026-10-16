import { requirePagina } from "@/lib/auth/pagina";

/**
 * Movimentar caixas é do módulo `caixas`. O layout de cima deixa entrar quem
 * tem só embalagens (a tela de abas é compartilhada); este não.
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePagina({ modulo: "caixas" });
  return children;
}
