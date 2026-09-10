import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireTenant } from "@/lib/auth/session";
import { CotacoesEnvioService } from "@/lib/services/cotacoes-envio.service";
import { PageHeader } from "@/components/data/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { Button } from "@/components/ui/button";
import { EnviarBoletimForm } from "./_components/enviar-boletim-form";

export const dynamic = "force-dynamic";

/**
 * Envio de boletim pelo cliente — só em praça sem busca automática.
 *
 * Das 66 praças do catálogo, 57 não têm raspador, e o boletim delas só existe se
 * alguém colar. Antes disto, esse alguém era sempre o operador da plataforma:
 * ele precisava obter o boletim de uma praça que não é dele, todos os dias, para
 * cada cliente. Quem ficava sem preço era justamente quem contratou o módulo.
 *
 * O que o cliente envia NÃO vai para o ar: entra numa fila que só ele vê, e o
 * operador publica. A explicação de por que a fila existe está em
 * `cotacoes-envio.service.ts` — em resumo, `ceasa_quotes` é global e a gravação
 * sobrescreve, então um envio direto seria um cliente mexendo no preço que os
 * concorrentes dele leem, sem caminho de volta.
 */
export default async function EnviarBoletimPage() {
  const { tenantId } = await requireTenant();
  const { central, podeEnviar, enviados } = await CotacoesEnvioService.getTela(tenantId);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Enviar boletim da sua praça"
        description="Para as centrais que não publicam os preços de forma automática."
      />

      <Button asChild variant="ghost" size="sm" className="self-start">
        <Link href="/cotacoes">
          <ArrowLeft className="size-4" />
          Voltar às cotações
        </Link>
      </Button>

      {!central ? (
        <EmptyState
          title="Escolha a sua central primeiro"
          description="Sem saber em qual praça você compra, não há boletim a enviar."
          action={
            <Button asChild size="sm">
              <Link href="/cotacoes">Escolher central</Link>
            </Button>
          }
        />
      ) : !podeEnviar ? (
        /*
          Praça com raspador não aceita envio, e a frase diz por quê.

          Os dois caminhos gravariam a mesma data, e a gravação sobrescreve: o
          preço passaria a mudar conforme quem chegou por último, que é um
          comportamento impossível de explicar olhando a tela. Recusar com
          "não é preciso" é diferente de recusar sem motivo.
        */
        <EmptyState
          title="A sua central já busca o boletim sozinha"
          description={`${central.name} tem busca automática — o boletim chega todo dia sem você fazer nada. Enviar à mão só é necessário nas praças que não publicam de forma automática.`}
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/cotacoes">Ver as cotações</Link>
            </Button>
          }
        />
      ) : (
        <EnviarBoletimForm central={central} enviados={enviados} />
      )}
    </div>
  );
}
