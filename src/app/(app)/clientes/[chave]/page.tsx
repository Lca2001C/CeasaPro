import { redirect } from "next/navigation";

/** A ficha do cliente mudou para dentro de Vendas. */
export default async function ClienteAntigoPage({ params }: { params: Promise<{ chave: string }> }) {
  const { chave } = await params;
  redirect(`/vendas/clientes/${chave}`);
}
