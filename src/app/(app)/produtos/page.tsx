import { redirect } from "next/navigation";

/** Produtos agora vivem no Estoque (lista, cadastro e edição numa tela só). */
export default function ProdutosPage() {
  redirect("/estoque");
}
