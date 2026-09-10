import { ListaSkeleton } from "@/components/data/lista-skeleton";

/**
 * Contorno enquanto a tela carrega: catálogo de produtos.
 *
 * Ver `ListaSkeleton` para o porquê de existir contorno e não spinner.
 */
export default function Carregando() {
  return <ListaSkeleton linhas={8} comFiltros />;
}
