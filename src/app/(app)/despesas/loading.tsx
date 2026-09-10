import { ListaSkeleton } from "@/components/data/lista-skeleton";

/**
 * Contorno enquanto a tela carrega: contas do mês, com filtro por situação.
 *
 * Ver `ListaSkeleton` para o porquê de existir contorno e não spinner.
 */
export default function Carregando() {
  return <ListaSkeleton linhas={8} comFiltros />;
}
