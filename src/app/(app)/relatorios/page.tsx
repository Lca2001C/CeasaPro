import Link from "next/link";
import { FileBarChart, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/data/page-header";
import { Card } from "@/components/ui/card";
import { REPORT_TYPES, REPORT_LABELS } from "@/lib/reports/report.types";

export default function RelatoriosPage() {
  return (
    <div>
      <PageHeader title="Relatorios" description="Filtre por periodo, imprima ou baixe em Excel/PDF." />
      <div className="flex flex-col gap-2">
        {REPORT_TYPES.map((t) => (
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
    </div>
  );
}
