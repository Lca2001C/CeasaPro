import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { CotacoesService } from "@/lib/services/cotacoes.service";
import { explicacaoSemBoletim } from "@/lib/cotacoes/frescor";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { Button } from "@/components/ui/button";
import { VinculoForm } from "./_components/vinculo-form";

export const dynamic = "force-dynamic";

export default async function VincularCotacoesPage() {
  const { tenantId } = await requireTenant();
  const { produtos, doBoletim, central } = await CotacoesService.getTelaDeVinculo(tenantId);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Vincular cotações"
        description="Diga qual produto do boletim corresponde a cada produto seu. É uma vez só."
      />

      <Button asChild variant="ghost" size="sm" className="self-start">
        <Link href="/cotacoes">
          <ArrowLeft className="size-4" />
          Voltar às cotações
        </Link>
      </Button>

      {produtos.length === 0 ? (
        <EmptyState
          title="Nenhum produto cadastrado"
          description="Cadastre seus produtos para poder vinculá-los às cotações do CEASA."
        />
      ) : doBoletim.length === 0 ? (
        /*
          A explicação depende de a praça ter fonte automática. "Assim que o
          primeiro chegar" é uma promessa que só se cumpre onde existe raspador;
          em 57 das 66 praças do catálogo o boletim depende de alguém enviar, e
          dizer a mesma frase ali é prometer o que não vem.
        */
        <EmptyState
          title="Nenhuma cotação disponível"
          description={explicacaoSemBoletim(central?.automatica ?? false)}
        />
      ) : (
        <VinculoForm produtos={produtos} doBoletim={doBoletim} />
      )}
    </div>
  );
}
