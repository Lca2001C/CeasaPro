import { AlertTriangle } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/session";
import { CatalogoImagensService } from "@/lib/services/catalogo-imagens.service";
import { r2Configurado } from "@/lib/storage/r2";
import { PageHeader } from "@/components/data/page-header";
import { Card } from "@/components/ui/card";
import { NovaFoto } from "./_components/nova-foto";
import { FotoDoBanco } from "./_components/foto-do-banco";

export const dynamic = "force-dynamic";

/**
 * Banco de fotos da plataforma — o "Banco" do cadastro de produto.
 *
 * Toda empresa vê as fotos ATIVAS daqui ao cadastrar um produto e busca pelo
 * nome. Foto em uso por algum produto não pode ser excluída (o produto guarda a
 * mesma chave); para tirá-la do Banco, desative.
 */
export default async function AdminImagensPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireSuperAdmin();
  const { q } = await searchParams;
  const fotos = await CatalogoImagensService.listarAdmin(q);
  const disponivel = r2Configurado();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Banco de fotos"
        description="Fotos de produto que todos os clientes podem escolher no cadastro."
      />

      {!disponivel && (
        <Card className="flex items-start gap-2 border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            O armazenamento de fotos (Cloudflare R2) não está configurado. Preencha R2_ACCOUNT_ID,
            R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET e R2_PUBLIC_URL.
          </span>
        </Card>
      )}

      {disponivel && <NovaFoto />}

      <form className="flex gap-2" action="/admin/imagens">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Buscar por nome..."
          aria-label="Buscar foto por nome"
          className="h-10 flex-1 rounded-md border bg-background px-3 text-sm"
        />
        <button type="submit" className="h-10 rounded-md border px-4 text-sm">
          Buscar
        </button>
      </form>

      {fotos.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {q ? "Nenhuma foto com esse nome." : "Nenhuma foto no banco ainda."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {fotos.map((f) => (
            <FotoDoBanco key={f.id} foto={f} />
          ))}
        </div>
      )}
    </div>
  );
}
