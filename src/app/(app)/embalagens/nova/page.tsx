import { redirect } from "next/navigation";

/** A venda de embalagem abre em folha sobre a aba Embalagens. */
export default function NovaVendaEmbalagemPage() {
  redirect("/caixas-plasticas?aba=embalagens&nova=1");
}
