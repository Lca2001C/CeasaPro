import { FileBarChart, Lock } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/plan/modules";
import { PageHeader } from "@/components/data/page-header";
import { ListaDeAcoes, LinhaDeAcao } from "@/components/ui/linha-de-acao";
import { REPORT_GROUPS, REPORT_LABELS, isAdvancedReport } from "@/lib/reports/report.types";

export const dynamic = "force-dynamic";

export default async function RelatoriosPage() {
  const session = await getSession();
  const avancadosOn = isModuleEnabled(session?.modules, "relatorios_avancados");

  return (
    <div>
      <PageHeader
        title="Relatórios"
        description="Filtre por período, imprima ou baixe em Excel/PDF."
      />

      <div className="flex flex-col gap-5">
        {REPORT_GROUPS.map((grupo) => {
          // Grupo sem NADA (nem liberado nem bloqueado) não aparece. Para os
          // grupos de hoje isso não acontece — há teste garantindo que nenhum
          // é vazio —, e o caso que importa é o outro: grupo inteiramente
          // pago, que aparece com a linha de upsell (cadeado) em vez de
          // seção vazia. É o que sustenta a decisão registrada em
          // `relatorios-grupos.test.ts` de permitir grupo 100% pago.
          const disponiveis = grupo.relatorios.filter((t) => !isAdvancedReport(t) || avancadosOn);
          const bloqueados = grupo.relatorios.length - disponiveis.length;
          if (disponiveis.length === 0 && bloqueados === 0) return null;

          return (
            <ListaDeAcoes key={grupo.titulo} titulo={grupo.titulo}>
              {disponiveis.map((t) => (
                <LinhaDeAcao
                  key={t}
                  href={`/relatorios/${t.toLowerCase()}`}
                  icone={<FileBarChart />}
                  titulo={REPORT_LABELS[t]}
                />
              ))}

              {bloqueados > 0 && (
                <LinhaDeAcao
                  href="/plano?bloqueado=relatorios_avancados"
                  icone={<Lock />}
                  tom="neutro"
                  titulo={`+ ${bloqueados} relatório(s) em outro plano`}
                  descricao={grupo.relatorios
                    .filter((t) => isAdvancedReport(t))
                    .map((t) => REPORT_LABELS[t])
                    .join(" · ")}
                />
              )}
            </ListaDeAcoes>
          );
        })}
      </div>
    </div>
  );
}
