import Link from "next/link";
import { FileBarChart, ChevronRight, Lock } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/plan/modules";
import { PageHeader } from "@/components/data/page-header";
import { Card } from "@/components/ui/card";
import { REPORT_GROUPS, REPORT_LABELS, isAdvancedReport } from "@/lib/reports/report.types";

export const dynamic = "force-dynamic";

export default async function RelatoriosPage() {
  const session = await getSession();
  const avancadosOn = isModuleEnabled(session?.modules, "relatorios_avancados");

  return (
    <div>
      <PageHeader title="Relatórios" description="Filtre por período, imprima ou baixe em Excel/PDF." />

      <div className="flex flex-col gap-5">
        {REPORT_GROUPS.map((grupo) => {
          // Um grupo só aparece se tiver algo que o plano libera — senão o
          // usuário abriria uma seção vazia sem entender por quê.
          const disponiveis = grupo.relatorios.filter(
            (t) => !isAdvancedReport(t) || avancadosOn,
          );
          const bloqueados = grupo.relatorios.length - disponiveis.length;
          if (disponiveis.length === 0 && bloqueados === 0) return null;

          return (
            <section key={grupo.titulo}>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                {grupo.titulo}
              </h2>
              <div className="flex flex-col gap-2">
                {disponiveis.map((t) => (
                  <Link key={t} href={`/relatorios/${t.toLowerCase()}`}>
                    <Card className="flex min-h-14 items-center justify-between p-4 hover:bg-accent/40">
                      <div className="flex items-center gap-3">
                        <FileBarChart className="size-5 shrink-0 text-primary" />
                        <span className="font-medium">{REPORT_LABELS[t]}</span>
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </Card>
                  </Link>
                ))}

                {bloqueados > 0 && (
                  <Link href="/plano?bloqueado=relatorios_avancados">
                    <Card className="flex min-h-14 items-center justify-between border-dashed p-4 hover:bg-accent/40">
                      <div className="flex min-w-0 items-center gap-3">
                        <Lock className="size-5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <span className="block font-medium">
                            + {bloqueados} relatório(s) em outro plano
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {grupo.relatorios
                              .filter((t) => isAdvancedReport(t))
                              .map((t) => REPORT_LABELS[t])
                              .join(" · ")}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </Card>
                  </Link>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
