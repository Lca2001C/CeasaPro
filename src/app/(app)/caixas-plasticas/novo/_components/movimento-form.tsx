"use client";

import { isoDateTz } from "@/lib/tz";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { registrarMovimentoCaixa } from "@/actions/caixas.actions";
import type { CaixaMovimentoInput } from "@/lib/validations/caixa";
import type { CrateSaldo } from "@/lib/services/caixas.service";
import { CRATE_MOVEMENT_LABELS, toOptions } from "@/lib/labels";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Tipo = CaixaMovimentoInput["type"];

/** Quantas caixas o tipo escolhido pode consumir â€” orienta o usuÃ¡rio antes do erro. */
function disponivel(type: Tipo, saldo: CrateSaldo): string | null {
  switch (type) {
    case "SAIDA":
      return `${saldo.limpas} caixa(s) limpa(s) em estoque`;
    case "RETORNO":
      return `${saldo.comClientes} caixa(s) com clientes`;
    case "SAIDA_HIGIENIZACAO":
      return `${saldo.sujas} caixa(s) suja(s) em estoque`;
    case "RETORNO_HIGIENIZACAO":
      return `${saldo.emHigienizacao} caixa(s) no higienizador`;
    default:
      return null;
  }
}

export function MovimentoCaixaForm({ saldo }: { saldo: CrateSaldo }) {
  const router = useRouter();
  const [type, setType] = useState<Tipo>("ENTRADA");
  const [quantity, setQuantity] = useState("");
  const [brokenQty, setBrokenQty] = useState("");
  const [dirty, setDirty] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [cleanerName, setCleanerName] = useState("");
  const [movementDate, setMovementDate] = useState(isoDateTz());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const needsCustomer = type === "SAIDA" || type === "RETORNO";
  const needsCleaner = type === "SAIDA_HIGIENIZACAO" || type === "RETORNO_HIGIENIZACAO";
  const isEntrada = type === "ENTRADA";
  const isQuebra = type === "QUEBRA";
  const hint = disponivel(type, saldo);

  async function submit() {
    const qty = parseInt(quantity, 10);
    if (!qty || qty <= 0) return toast.error("Informe a quantidade.");
    if (needsCustomer && !customerName.trim()) return toast.error("Informe o cliente.");
    if (needsCleaner && !cleanerName.trim()) return toast.error("Informe o higienizador.");

    setSaving(true);
    const res = await registrarMovimentoCaixa({
      type,
      quantity: qty,
      brokenQty: isEntrada && brokenQty ? parseInt(brokenQty, 10) : undefined,
      dirty: isEntrada || isQuebra ? dirty : undefined,
      customerName: customerName.trim() || null,
      supplierName: supplierName.trim() || null,
      cleanerName: cleanerName.trim() || null,
      movementDate,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (res.ok) {
      toast.success("MovimentaÃ§Ã£o registrada.");
      router.push("/caixas-plasticas");
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Tipo de movimentaÃ§Ã£o</Label>
        <Select value={type} onChange={(e) => setType(e.target.value as Tipo)}>
          {toOptions(CRATE_MOVEMENT_LABELS).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        {hint && <span className="text-xs text-muted-foreground">DisponÃ­vel: {hint}</span>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Quantidade de caixas</Label>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Data</Label>
          <Input type="date" value={movementDate} onChange={(e) => setMovementDate(e.target.value)} />
        </div>
      </div>

      {isEntrada && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>Origem / fornecedor (opcional)</Label>
            <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Caixas quebradas na chegada (opcional)</Label>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={brokenQty}
              onChange={(e) => setBrokenQty(e.target.value)}
            />
          </div>
        </>
      )}

      {(isEntrada || isQuebra) && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={dirty}
            onChange={(e) => setDirty(e.target.checked)}
          />
          {isEntrada
            ? "As caixas chegaram sujas (vÃ£o para a fila de higienizaÃ§Ã£o)"
            : "A caixa quebrada estava suja (aguardando higienizaÃ§Ã£o)"}
        </label>
      )}

      {(needsCustomer || isQuebra) && (
        <div className="flex flex-col gap-1.5">
          <Label>
            {isQuebra ? "Cliente (se a caixa sumiu com um cliente â€” opcional)" : "Cliente"}
          </Label>
          <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
        </div>
      )}

      {(needsCleaner || isQuebra) && (
        <div className="flex flex-col gap-1.5">
          <Label>
            {isQuebra
              ? "Higienizador (se a caixa sumiu na lavagem â€” opcional)"
              : "Higienizador"}
          </Label>
          <Input value={cleanerName} onChange={(e) => setCleanerName(e.target.value)} />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label>ObservaÃ§Ãµes (opcional)</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button className="flex-1" onClick={submit} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Registrar
        </Button>
      </div>
    </div>
  );
}
