"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { chavePorConteudo, type RefDeChave } from "@/lib/idempotencia-cliente";
import { mensagemDoErro } from "@/lib/http/mensagem-erro";
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
  // Chave amarrada ao conteúdo (valor + forma): o reenvio do MESMO recebimento
  // depois de um timeout devolve o já gravado; outro valor é outro recebimento.
  const chave: RefDeChave = useRef(null);

  async function submit() {
    if (!amount || amount <= 0) return toast.error("Informe o valor do pagamento.");
    setSaving(true);
    const corpo = { accountId, amount, method };
    const res = await apiPost("/api/fiado/pagamento", {
      ...corpo,
      idempotencyKey: chavePorConteudo(chave, corpo),
    });
    setSaving(false);
    if (res.ok) {
      chave.current = null;
      toast.success("Pagamento registrado.");
      router.refresh();
    } else {
      toast.error(mensagemDoErro(res.error));
      // Timeout pode ter gravado: o saldo atualizado na tela evita relançar.
      if (res.error.code === "TIMEOUT" || res.error.code === "NETWORK") router.refresh();
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
          onChange={setAmount}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Forma</Label>
        <Select
          aria-label="Forma de pagamento"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
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
