"use client";

import { isoDateTz } from "@/lib/tz";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { registrarMovimentoCaixa } from "@/actions/caixas.actions";
import { caixaMovimentoTipoEnum, type CaixaMovimentoInput } from "@/lib/validations/caixa";
import type { CrateSaldo } from "@/lib/services/caixas.service";
import { CRATE_MOVEMENT_LABELS } from "@/lib/labels";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import { chamarAction } from "@/lib/http/chamar-action";
type Tipo = CaixaMovimentoInput["type"];

/**
 * As opções do `<select>` saem do MESMO enum que o servidor valida.
 *
 * Montá-las a partir de `CRATE_MOVEMENT_LABELS` oferecia "Estorno de venda
 * cancelada" (e os movimentos do higienizador), que o schema sempre recusa: o
 * usuário preenchia tudo e recebia "Verifique os campos destacados" sem campo
 * nenhum destacado.
 */
export const TIPOS_MANUAIS = caixaMovimentoTipoEnum.options.map((value) => ({
  value,
  label: CRATE_MOVEMENT_LABELS[value] ?? value,
}));

/** Quantas caixas o tipo escolhido pode consumir — orienta o usuário antes do erro. */
function disponivel(type: Tipo, saldo: CrateSaldo): string | null {
  switch (type) {
    case "SAIDA":
      return `${saldo.limpas} caixa(s) limpa(s) em estoque`;
    case "RETORNO":
      return `${saldo.comClientes} caixa(s) com clientes`;
    default:
      return null;
  }
}

/** id do `<datalist>` de clientes — mesmo padrão do PDV. */
const LISTA_CLIENTES = "caixas-clientes-conhecidos";

export function MovimentoCaixaForm({
  saldo,
  tipoInicial,
  quantidadeInicial,
  clienteInicial,
  clientesConhecidos = [],
}: {
  saldo: CrateSaldo;
  /** Situação escolhida no atalho da lista (ex.: "Cliente devolveu"). */
  tipoInicial?: Tipo;
  /** Quantidade sugerida — vem do saldo que o atalho conhece. */
  quantidadeInicial?: string;
  clienteInicial?: string;
  /** Evita o mesmo cliente virar dois nomes diferentes no livro-razão. */
  clientesConhecidos?: string[];
}) {
  const router = useRouter();
  const [type, setType] = useState<Tipo>(tipoInicial ?? "ENTRADA");
  const [quantity, setQuantity] = useState(quantidadeInicial ?? "");
  const [brokenQty, setBrokenQty] = useState("");
  const [dirty, setDirty] = useState(false);
  const [customerName, setCustomerName] = useState(clienteInicial ?? "");
  const [supplierName, setSupplierName] = useState("");
  const [movementDate, setMovementDate] = useState(isoDateTz());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const needsCustomer = type === "SAIDA" || type === "RETORNO";
  const isEntrada = type === "ENTRADA";
  const isQuebra = type === "QUEBRA";
  const hint = disponivel(type, saldo);

  async function submit() {
    const qty = parseInt(quantity, 10);
    if (!qty || qty <= 0) return toast.error("Informe a quantidade.");
    if (needsCustomer && !customerName.trim()) return toast.error("Informe o cliente.");
    const quebradas = isEntrada && brokenQty ? parseInt(brokenQty, 10) : undefined;
    if (quebradas !== undefined && quebradas > qty) {
      return toast.error("As quebradas não podem passar do total de caixas recebidas.");
    }

    setSaving(true);
    const res = await chamarAction(() => registrarMovimentoCaixa({
      type,
      quantity: qty,
      brokenQty: quebradas,
      dirty: isEntrada || isQuebra ? dirty : undefined,
      customerName: customerName.trim() || null,
      supplierName: supplierName.trim() || null,
      movementDate,
      notes: notes.trim() || null,
    }));
    setSaving(false);
    if (res.ok) {
      toast.success("Movimentação registrada.");
      router.push("/caixas-plasticas");
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="type">Tipo de movimentação</Label>
        <Select id="type" value={type} onChange={(e) => setType(e.target.value as Tipo)}>
          {TIPOS_MANUAIS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        {hint && <span className="text-xs text-muted-foreground">Disponível: {hint}</span>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          {/* Na ENTRADA é o TOTAL recebido; as quebradas são parte dele — o
              rótulo do campo de quebradas ("Dessas, …") diz isso. */}
          <Label htmlFor="quantity">Quantidade de caixas</Label>
          <Input
            id="quantity"
            type="number"
            inputMode="numeric"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="movementDate">Data</Label>
          <Input id="movementDate" type="date" value={movementDate} onChange={(e) => setMovementDate(e.target.value)} />
        </div>
      </div>

      {isEntrada && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="supplierName">Origem / fornecedor (opcional)</Label>
            <Input id="supplierName" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brokenQty">Dessas, quantas chegaram quebradas (opcional)</Label>
            <Input
              id="brokenQty"
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
            ? "As caixas chegaram sujas (vão para a fila de higienização)"
            : "A caixa quebrada estava suja (aguardando higienização)"}
        </label>
      )}

      {(needsCustomer || isQuebra) && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="customerName">
            {isQuebra ? "Cliente (se a caixa sumiu com um cliente — opcional)" : "Cliente"}
          </Label>
          <Input
            id="customerName"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            list={LISTA_CLIENTES}
          />
          {/* Autocomplete com quem já comprou: o saldo de caixas é agrupado
              POR NOME, então "João" e "joao" viram dois devedores diferentes. */}
          <datalist id={LISTA_CLIENTES}>
            {clientesConhecidos.map((nome) => (
              <option key={nome} value={nome} />
            ))}
          </datalist>
        </div>
      )}

      {/* Perda no higienizador não se lança aqui: solta, ela não fica ligada ao
          lote, e o lote nunca mais fecha. O caminho é o próprio envio. */}
      {isQuebra && (
        <p className="text-xs text-muted-foreground">
          Sumiu ou quebrou no higienizador? Registre no próprio envio, em{" "}
          <Link href="/higienizacao" className="underline">
            Higienização
          </Link>
          .
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Observações (opcional)</Label>
        <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
