import { redirect } from "next/navigation";

/** A edição de produto é o mesmo modal do Estoque, aberto pelo `?editar=`. */
export default async function EditarProdutoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/estoque?editar=${encodeURIComponent(id)}`);
}
