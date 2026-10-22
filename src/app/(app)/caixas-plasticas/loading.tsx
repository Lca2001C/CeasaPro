import { ListaSkeleton } from "@/components/data/lista-skeleton";

/**
 * Contorno enquanto a tela de caixas e embalagens carrega (saldos e histórico).
 * Ver `ListaSkeleton` para o porquê de contorno e não spinner.
 */
export default function Carregando() {
  return <ListaSkeleton linhas={6} comFiltros />;
}
