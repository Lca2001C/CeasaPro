import { redirect } from "next/navigation";

/**
 * "Meu plano" virou uma aba de Configurações. Esta rota continua existindo
 * porque o proxy e o gate de módulo mandam para `/plano?bloqueado=<módulo>`.
 */
export default async function MeuPlanoPage({
  searchParams,
}: {
  searchParams: Promise<{ bloqueado?: string }>;
}) {
  const { bloqueado } = await searchParams;
  const q = new URLSearchParams({ aba: "plano" });
  if (bloqueado) q.set("bloqueado", bloqueado);
  redirect(`/configuracoes?${q.toString()}`);
}
