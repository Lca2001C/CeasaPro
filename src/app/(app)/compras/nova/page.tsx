import { redirect } from "next/navigation";

/** Registrar compra agora fica dentro do Estoque. */
export default function NovaCompraPage() {
  redirect("/estoque/compra");
}
