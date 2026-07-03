import * as React from "react";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";

interface Props {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "destructive";
}

const toneClasses: Record<NonNullable<Props["tone"]>, string> = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

/** Card grande de KPI para o dashboard — número em destaque, leitura rápida. */
export function StatCard({ label, value, hint, icon, tone = "default" }: Props) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className={cn("mt-2 text-2xl font-bold tabular-nums sm:text-3xl", toneClasses[tone])}>
        {value}
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}
