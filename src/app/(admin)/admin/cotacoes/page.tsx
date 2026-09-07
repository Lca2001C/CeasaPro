import { AlertTriangle } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/session";
import { CotacoesImportService } from "@/lib/services/cotacoes-import.service";
import { frescorDoBoletim, rotuloDeFrescor } from "@/lib/cotacoes/frescor";
import { CEASA_IMPORT_STATUS_LABELS } from "@/lib/labels";
import { formatDate, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/data/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { ImportarManual } from "./_components/importar-manual";

export const dynamic = "force-dynamic";

/**
 * Saúde da importação de cotações.
 *
 * Esta tela existe porque raspagem quebra, e o desfecho normal de uma raspagem
 * quebrada é o módulo morrer sem ninguém perceber. Aqui a quebra fica visível
 * para quem pode consertar — e ao lado dela fica o caminho manual, para o
 * módulo continuar de pé enquanto o conserto não sai.
 */
export default async function AdminCotacoesPage() {
  await requireSuperAdmin();
  const centrais = await CotacoesImportService.situacaoDasCentrais();
  const agora = new Date();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Cotações do CEASA"
        description="Estado da importação por central e entrada manual de boletim."
      />

      <div className="flex flex-col gap-2">
        {centrais.map((c) => {
          const frescor = frescorDoBoletim(c.ultimoBoletim, agora);
          const rotulo = rotuloDeFrescor(frescor);
          // Só alarma central que tem cliente: uma central que ninguém usa estar
          // sem boletim é o esperado, não um problema.
          const preocupante = c.clientes > 0 && frescor.nivel !== "atual";
          return (
            <Card
              key={c.code}
              className={cn("p-3", preocupante && "border-warning/50 bg-warning/5")}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {c.name}{" "}
                    <span className="font-normal text-muted-foreground">
                      ({c.code} · {c.sourceKey})
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.clientes === 0
                      ? "Nenhuma empresa usa esta central"
                      : `${c.clientes} ${c.clientes === 1 ? "empresa usa" : "empresas usam"}`}
                    {" · "}
                    {c.ultimoBoletim
                      ? `último boletim ${formatDate(c.ultimoBoletim)}`
                      : "nenhum boletim recebido"}
                  </p>
                  {c.ultimaExecucao && (
                    <p className="text-xs text-muted-foreground">
                      Última tentativa: {CEASA_IMPORT_STATUS_LABELS[c.ultimaExecucao.status]} ·{" "}
                      {c.ultimaExecucao.rowsUpserted} linhas ·{" "}
                      {formatDateTime(c.ultimaExecucao.startedAt)}
                      {c.ultimaExecucao.error && ` · ${c.ultimaExecucao.error}`}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {!c.active && <Badge variant="secondary">Desativada</Badge>}
                  {preocupante && rotulo && (
                    <Badge variant="warning" className="gap-1">
                      <AlertTriangle className="size-3" />
                      {rotulo}
                    </Badge>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Importar boletim manualmente</CardTitle>
        </CardHeader>
        <CardContent>
          <ImportarManual centrais={centrais.filter((c) => c.active)} />
        </CardContent>
      </Card>
    </div>
  );
}
