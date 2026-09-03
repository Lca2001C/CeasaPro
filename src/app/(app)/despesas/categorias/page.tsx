import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { DespesasService } from "@/lib/services/despesas.service";
import { PageHeader } from "@/components/data/page-header";
import { Button } from "@/components/ui/button";
import { CategoriasManager } from "./_components/categorias-manager";

export const dynamic = "force-dynamic";

export default async function CategoriasDespesaPage() {
  const { tenantId } = await requireTenant();
  const categorias = await DespesasService.listCategoriesComUso(tenantId);

  return (
    <div>
      <PageHeader
        title="Categorias de despesa"
        description="Organize suas contas do jeito que o seu box funciona."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/despesas">
              <ArrowLeft className="size-4" /> Voltar
            </Link>
          </Button>
        }
      />
      <CategoriasManager
        categorias={categorias.map((c) => ({
          id: c.id,
          name: c.name,
          isDefault: c.isDefault,
          despesas: c.despesas,
        }))}
      />
    </div>
  );
}
