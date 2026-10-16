import Link from "next/link";
import { Plus, Pencil } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { FornecedoresService } from "@/lib/services/fornecedores.service";
import { excluirFornecedor } from "@/actions/fornecedores.actions";
import { formatPhone } from "@/lib/format";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DeleteButton } from "@/components/crud/delete-button";

export const dynamic = "force-dynamic";

export default async function FornecedoresPage() {
  const { tenantId } = await requireTenant();
  const fornecedores = await FornecedoresService.list(tenantId);

  return (
    <div>
      <PageHeader
        title="Fornecedores"
        description="Cadastre de quem você compra."
        action={
          <Button asChild size="sm">
            <Link href="/fornecedores/novo">
              <Plus /> Novo
            </Link>
          </Button>
        }
      />

      {fornecedores.length === 0 ? (
        <EmptyState
          title="Nenhum fornecedor cadastrado"
          description="Toque em Novo para cadastrar seu primeiro fornecedor."
          action={
            <Button asChild>
              <Link href="/fornecedores/novo">
                <Plus /> Novo fornecedor
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {fornecedores.map((f) => (
            <Card
              key={f.id}
              className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{f.name}</span>
                  {!f.active && <Badge variant="secondary">Inativo</Badge>}
                </div>
                {f.phone && (
                  <span className="text-xs text-muted-foreground">{formatPhone(f.phone)}</span>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button asChild variant="info" size="sm">
                  <Link href={`/fornecedores/${f.id}`}>
                    <Pencil /> Editar
                  </Link>
                </Button>
                <DeleteButton
                  action={excluirFornecedor}
                  id={f.id}
                  entityLabel={`o fornecedor ${f.name}`}
                />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
