import { redirect } from "next/navigation";

/** O histórico de compras é a aba "Compras" do Estoque. */
export default function ComprasPage() {
  redirect("/estoque?aba=compras");
}
