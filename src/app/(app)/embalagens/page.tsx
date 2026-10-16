import { redirect } from "next/navigation";

/**
 * Embalagens virou uma aba de Caixas e embalagens. O endereço antigo continua
 * valendo — favoritos, atalhos e links já enviados caem na aba certa. O gate do
 * módulo segue no `layout.tsx` deste segmento.
 */
export default function EmbalagensPage() {
  redirect("/caixas-plasticas?aba=embalagens");
}
