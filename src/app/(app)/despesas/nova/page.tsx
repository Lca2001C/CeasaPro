import { requireTenant } from "@/lib/auth/session";
import { DespesasService } from "@/lib/services/despesas.service";
import { PageHeader } from "@/components/data/page-header";
import { DespesaForm } from "../_components/despesa-form";

export const dynamic = "force-dynamic";

/**
 * Nova despesa — em branco, ou já preenchida a partir de outra.
 *
 * `?duplicar=<id>` copia uma conta específica; `?duplicar=ultima` repete a
 * última lançada ("+ Nova igual à última"). Em ambos os casos o formulário abre
 * preenchido em vez de gravar sozinho: conta de luz muda de valor todo mês, e
 * criar direto obrigaria a editar em seguida.
 */
export default async function NovaDespesaPage({
  searchParams,
}: {
  searchParams: Promise<{ duplicar?: string }>;
}) {
  const { duplicar } = await searchParams;
  const { tenantId } = await requireTenant();

  const [categories, preenchido] = await Promise.all([
    DespesasService.listCategories(tenantId),
    duplicar
      ? DespesasService.dadosParaDuplicar(tenantId, duplicar).catch(() => null)
      : Promise.resolve(null),
  ]);

  return (
    <div>
      <PageHeader
        title={preenchido ? "Nova despesa (copiada)" : "Nova despesa"}
        description={
          preenchido
            ? "Confira o valor e o vencimento antes de salvar."
            : undefined
        }
      />
      <DespesaForm
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        preenchido={preenchido ?? undefined}
      />
    </div>
  );
}
