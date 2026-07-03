import Link from "next/link";
import { Plus, Pencil } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { ProdutosService } from "@/lib/services/produtos.service";
import { excluirProduto } from "@/actions/produtos.actions";
import { SALE_UNIT_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DeleteButton } from "@/components/crud/delete-button";

export const dynamic = "force-dynamic";

export default async function ProdutosPage() {
  const { tenantId } = await requireTenant();
  const produtos = await ProdutosService.list(tenantId);

  return (
    <div>
      <PageHeader
        title="Produtos"
        description="Cadastre os produtos que você comercializa."
        action={
          <Button asChild size="sm">
            <Link href="/produtos/novo">
              <Plus /> Novo
            </Link>
          </Button>
        }
      />

      {produtos.length === 0 ? (
        <EmptyState
          title="Nenhum produto cadastrado ainda"
          description="Toque em Novo para cadastrar seu primeiro produto."
          action={
            <Button asChild>
              <Link href="/produtos/novo">
                <Plus /> Novo produto
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {produtos.map((p) => (
            <Card key={p.id} className="flex items-center justify-between p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{p.name}</span>
                  {!p.active && <Badge variant="secondary">Inativo</Badge>}
                </div>
                <span className="text-xs text-muted-foreground">
                  {SALE_UNIT_LABELS[p.saleUnit]}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button asChild variant="ghost" size="icon" aria-label="Editar">
                  <Link href={`/produtos/${p.id}`}>
                    <Pencil className="size-4" />
                  </Link>
                </Button>
                <DeleteButton
                  action={excluirProduto}
                  id={p.id}
                  entityLabel={`o produto ${p.name}`}
                />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
