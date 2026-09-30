"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { QuantityInput } from "@/components/forms/quantity-input";

/**
 * O que o operador escolhe na tela, e o que vai para a API.
 *
 * O acerto de inventário tem DUAS opções na tela e um tipo só no servidor:
 * `AJUSTE` positivo soma, negativo tira (ver `ajusteEstoqueSchema`). Antes só
 * existia "Ajuste (entrada)" e o campo de quantidade não aceita sinal, então
 * quem contava a prateleira e achava MENOS do que o sistema só podia lançar
 * "quebra" — mentindo sobre o motivo e inflando o relatório de perdas. O
 * operador escolhe a direção; o sinal é aplicado aqui, e ninguém digita "-".
 */
const TIPOS = [
  { value: "QUEBRA", label: "Quebra / Perda", tipo: "QUEBRA", sinal: 1 },
  { value: "DOACAO", label: "Doação", tipo: "DOACAO", sinal: 1 },
  { value: "AJUSTE", label: "Acerto para mais (sobrou)", tipo: "AJUSTE", sinal: 1 },
  { value: "AJUSTE_MENOS", label: "Acerto para menos (faltou)", tipo: "AJUSTE", sinal: -1 },
] as const;

type OpcaoTipo = (typeof TIPOS)[number]["value"];

const DICA: Partial<Record<OpcaoTipo, string>> = {
  AJUSTE: "Contou a prateleira e tem MAIS do que o sistema diz: informe quanto sobrou.",
  AJUSTE_MENOS:
    "Contou a prateleira e tem MENOS do que o sistema diz: informe quanto faltou. Não entra como perda.",
};

export function AjusteForm({ produtos }: { produtos: { id: string; name: string }[] }) {
  const router = useRouter();
  const [productId, setProductId] = useState(produtos[0]?.id ?? "");
  const [type, setType] = useState<OpcaoTipo>("QUEBRA");
  const [quantity, setQuantity] = useState<number | undefined>(undefined);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  // Trava SÍNCRONA contra toque duplo: `saving` só desabilita o botão no
  // próximo render, e dois toques no mesmo instante passariam os dois.
  const enviando = useRef(false);

  async function submit() {
    if (enviando.current) return;
    if (!productId) return toast.error("Selecione o produto.");
    if (!quantity || quantity <= 0) return toast.error("Informe a quantidade.");
    const escolhido = TIPOS.find((t) => t.value === type) ?? TIPOS[0];
    enviando.current = true;
    setSaving(true);
    const res = await apiPost("/api/estoque/ajuste", {
      productId,
      type: escolhido.tipo,
      quantity: escolhido.sinal * quantity,
      reason: reason || null,
    });
    if (res.ok) {
      // O botão continua travado no sucesso: a ida para /estoque é uma
      // transição, e esta tela segue clicável até a nova chegar. Liberar aqui
      // deixava um segundo toque lançar a mesma quebra duas vezes.
      toast.success("Movimentação registrada.");
      router.push("/estoque");
    } else {
      enviando.current = false;
      setSaving(false);
      toast.error(res.error.message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/*
        `htmlFor` + `id` em todos os quatro campos.

        O axe acusava `label` e `select-name` com impacto CRÍTICO nesta tela:
        os rótulos apareciam, mas soltos, sem nada ligando texto e campo. Num
        ajuste de estoque isso é sério — quem não enxerga a tela ouvia quatro
        controles sem nome e tinha de adivinhar qual era o produto e qual era a
        quantidade, num formulário que MEXE no saldo.
      */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="productId">Produto</Label>
        <Select
          id="productId"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
        >
          {produtos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="type">Tipo de movimentação</Label>
        <Select
          id="type"
          value={type}
          onChange={(e) => setType(e.target.value as OpcaoTipo)}
          aria-describedby={DICA[type] ? "type-dica" : undefined}
        >
          {TIPOS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        {DICA[type] && (
          <span id="type-dica" className="text-xs text-muted-foreground">
            {DICA[type]}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="quantity">Quantidade</Label>
        <QuantityInput id="quantity" value={quantity} onChange={setQuantity} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reason">Motivo (opcional)</Label>
        <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
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
