import { redirect } from "next/navigation";

/** Clientes vivem na tela de Vendas, na aba ao lado. */
export default function ClientesPage() {
  redirect("/vendas?aba=clientes");
}
