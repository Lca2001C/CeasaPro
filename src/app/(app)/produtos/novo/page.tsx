import { redirect } from "next/navigation";

/** O cadastro de produto é o modal "Novo Produto" do Estoque. */
export default function NovoProdutoPage() {
  redirect("/estoque?novo=1");
}
