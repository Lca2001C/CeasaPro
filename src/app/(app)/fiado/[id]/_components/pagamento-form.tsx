"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/forms/currency-input";

export function PagamentoForm({
  accountId,
  saldo,
}: {
  accountId: string;
  saldo: number;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState<number | undefined>(saldo);
  const [method, setMethod] = useState("DINHEIRO");
  const [saving, setSaving] = useState(false);
  // Uma chave por recebimento digitado: o reenvio depois de um timeout devolve
  // o já gravado. Mudar valor ou forma é outro recebimento — chave nova.
  const chave = useRef<string | null>(null);

  async function submit() {
    if (!amount || amount <= 0) return toast.error("Informe o valor do pagamento.");
    setSaving(true);
    chave.current ??= crypto.randomUUID();
    const res = await apiPost("/api/fiado/pagamento", {
      accountId,
      amount,
      method,
      idempotencyKey: chave.current,
    });
    setSaving(false);
    if (res.ok) {
      chave.current = null;
      toast.success("Pagamento registrado.");
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Valor recebido</Label>
        {/* Os `<Label>` daqui não apontam para os campos. Sem `aria-label`, o
            campo que define quanto o cliente pagou fica sem nome acessível. */}
        <CurrencyInput
          aria-label="Valor recebido"
          value={amount}
          onChange={(v) => {
            chave.current = null;
            setAmount(v);
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Forma</Label>
        <Select
          aria-label="Forma de pagamento"
          value={method}
          onChange={(e) => {
            chave.current = null;
            setMethod(e.target.value);
          }}
        >
          <option value="DINHEIRO">Dinheiro</option>
          <option value="PIX">PIX</option>
          <option value="CARTAO">Cartão</option>
        </Select>
      </div>
      <Button variant="success" size="lg" onClick={submit} disabled={saving}>
        {saving && <Loader2 className="animate-spin" />}
        Registrar pagamento
      </Button>
    </div>
  );
}
