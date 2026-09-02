import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { AdminShell } from "@/components/layout/admin-shell";
import { AdminNotificationsService } from "@/lib/services/admin-notifications.service";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/alterar-senha");
  if (session.role !== "SUPER_ADMIN") redirect("/dashboard");

  // Depois dos redirecionamentos: contar notificacoes de quem nem vai ver o
  // painel seria consulta jogada fora em todo acesso indevido.
  const { total, saturado } = await AdminNotificationsService.contarNaoLidas();

  return (
    <AdminShell userName={session.name} naoLidas={total} naoLidasSaturado={saturado}>
      {children}
    </AdminShell>
  );
}
