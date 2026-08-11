import Link from "next/link";
import { FileBarChart, ChevronRight, Lock } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/plan/modules";
import { PageHeader } from "@/components/data/page-header";
import { Card } from "@/components/ui/card";
import { BASIC_REPORTS, ADVANCED_REPORTS, REPORT_LABELS } from "@/lib/reports/report.types";

export const dynamic = "force-dynamic";

export default async function RelatoriosPage() {
  const session = await getSession();
  const avancadosOn = isModuleEnabled(session?.modules, "relatorios_avancados");

  return (
    <div>
      <PageHeader title="Relatórios" description="Filtre por período, imprima ou baixe em Excel/PDF." />

      <div className="flex flex-col gap-2">
        {BASIC_REPORTS.map((t) => (
          <Link key={t} href={`/relatorios/${t.toLowerCase()}`}>
            <Card className="flex items-center justify-between p-4 hover:bg-accent/40">
              <div className="flex items-center gap-3">
                <FileBarChart className="size-5 text-primary" />
                <span className="font-medium">{REPORT_LABELS[t]}</span>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Card>
          </Link>
        ))}
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold text-muted-foreground">
        Relatórios avançados
      </h2>

      {avancadosOn ? (
        <div className="flex flex-col gap-2">
          {ADVANCED_REPORTS.map((t) => (
            <Link key={t} href={`/relatorios/${t.toLowerCase()}`}>
              <Card className="flex items-center justify-between p-4 hover:bg-accent/40">
                <div className="flex items-center gap-3">
                  <FileBarChart className="size-5 text-primary" />
                  <span className="font-medium">{REPORT_LABELS[t]}</span>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Link href="/plano?bloqueado=relatorios_avancados">
          <Card className="flex items-center justify-between border-dashed p-4 hover:bg-accent/40">
            <div className="flex items-center gap-3">
              <Lock className="size-5 text-muted-foreground" />
              <div>
                <span className="block font-medium">
                  Disponível em outro plano
                </span>
                <span className="text-xs text-muted-foreground">
                  Lucro por produto, mais vendidos, inadimplentes, fluxo de caixa e mais.
                </span>
              </div>
            </div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Card>
        </Link>
      )}
    </div>
  );
}
