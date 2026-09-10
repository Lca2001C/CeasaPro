import { ListaSkeleton } from "@/components/data/lista-skeleton";

/**
 * Contorno enquanto a tela carrega: relatório montado por consulta agregada, que é a leitura mais cara do sistema.
 *
 * Ver `ListaSkeleton` para o porquê de existir contorno e não spinner.
 */
export default function Carregando() {
  return <ListaSkeleton linhas={10} />;
}
