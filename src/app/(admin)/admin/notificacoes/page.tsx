import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/session";
import { AdminNotificationsService } from "@/lib/services/admin-notifications.service";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { Button } from "@/components/ui/button";
import { ListaNotificacoes } from "./_components/lista-notificacoes";

export const dynamic = "force-dynamic";

export default async function AdminNotificacoesPage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string }>;
}) {
  await requireSuperAdmin();
  const { filtro } = await searchParams;
  const apenasNaoLidas = filtro === "NAO_LIDAS";

  const itens = await AdminNotificationsService.listar({ apenasNaoLidas });
  const temNaoLidas = itens.some((n) => n.readAt === null);

  return (
    <div>
      <PageHeader
        title="Notificações"
        description="O que aconteceu na operação do CeasaPro. Esta caixa é compartilhada entre os administradores."
      />

      <div className="mb-4 flex gap-2">
        <Button
          asChild
          size="sm"
          variant={apenasNaoLidas ? "outline" : "default"}
        >
          <Link href="/admin/notificacoes">Todas</Link>
        </Button>
        <Button
          asChild
          size="sm"
          variant={apenasNaoLidas ? "default" : "outline"}
        >
          <Link href="/admin/notificacoes?filtro=NAO_LIDAS">Não lidas</Link>
        </Button>
      </div>

      {itens.length === 0 ? (
        <EmptyState
          title={
            apenasNaoLidas ? "Nenhum aviso não lido" : "Nenhum aviso ainda"
          }
          description={
            apenasNaoLidas
              ? "Você já viu tudo."
              : "Cadastros novos e outros eventos da operação aparecem aqui."
          }
        />
      ) : (
        <ListaNotificacoes itens={itens} temNaoLidas={temNaoLidas} />
      )}
    </div>
  );
}
