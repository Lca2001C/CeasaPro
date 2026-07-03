"use client";

import { useState } from "react";
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

  async function submit() {
    if (!amount || amount <= 0) return toast.error("Informe o valor do pagamento.");
    setSaving(true);
    const res = await apiPost("/api/fiado/pagamento", { accountId, amount, method });
    setSaving(false);
    if (res.ok) {
      toast.success("Pagamento registrado.");
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Valor recebido</Label>
        <CurrencyInput value={amount} onChange={setAmount} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Forma</Label>
        <Select value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="DINHEIRO">Dinheiro</option>
          <option value="PIX">PIX</option>
          <option value="CARTAO">Cartão</option>
        </Select>
      </div>
      <Button onClick={submit} disabled={saving}>
        {saving && <Loader2 className="animate-spin" />}
        Registrar pagamento
      </Button>
    </div>
  );
}
