"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import type { PlanoInput } from "@/lib/validations/admin";
import { formatBRL } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlanoForm } from "./plano-form";

export function PlanoRow({ plano }: { plano: PlanoInput & { id: string } }) {
  const [editing, setEditing] = useState(false);

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{plano.name}</span>
            {!plano.active && <Badge variant="secondary">Inativo</Badge>}
          </div>
          <span className="text-xs text-muted-foreground">
            {plano.maxUsers ? `Até ${plano.maxUsers} usuários` : "Usuários ilimitados"} ·{" "}
            {plano.modules.length} módulo(s) opcional(is)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-semibold tabular-nums">{formatBRL(plano.priceMonthly)}/mês</span>
          <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => setEditing((v) => !v)}>
            <Pencil className="size-4" />
          </Button>
        </div>
      </div>
      {editing && (
        <div className="mt-3 border-t pt-3">
          <PlanoForm initial={plano} onDone={() => setEditing(false)} />
        </div>
      )}
    </Card>
  );
}
