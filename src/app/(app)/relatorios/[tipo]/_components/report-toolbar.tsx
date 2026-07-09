"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Printer, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

const PRESETS = [
  { value: "hoje", label: "Hoje" },
  { value: "semana", label: "Ultimos 7 dias" },
  { value: "mes", label: "Este mes" },
  { value: "mes_passado", label: "Mes passado" },
];

export function ReportToolbar({ kind }: { kind: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const preset = params.get("preset") ?? "mes";

  function changePreset(value: string) {
    router.push(`${pathname}?preset=${value}`);
  }

  const excelHref = `/api/reports/${kind}/export?preset=${preset}&format=excel`;
  const pdfHref = `/api/reports/${kind}/export?preset=${preset}&format=pdf`;

  return (
    <div className="no-print mb-4 flex flex-wrap items-center gap-2">
      <div className="w-44">
        <Select value={preset} onChange={(e) => changePreset(e.target.value)}>
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>
      <Button variant="outline" onClick={() => window.print()}>
        <Printer /> Imprimir / PDF
      </Button>
      <Button asChild variant="outline">
        <a href={excelHref}>
          <FileDown /> Baixar Excel
        </a>
      </Button>
      <Button asChild variant="outline">
        <a href={pdfHref}>
          <FileDown /> Baixar PDF
        </a>
      </Button>
    </div>
  );
}
