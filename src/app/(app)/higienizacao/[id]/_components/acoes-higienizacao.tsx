"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  registrarDevolucaoHigienizacao,
  registrarPagamentoHigienizacao,
} from "@/actions/higienizacao.actions";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencyInput } from "@/components/forms/currency-input";

export function AcoesHigienizacao({
  id,
  caixasAReceber,
  valorAPagar,
}: {
  id: string;
  caixasAReceber: number;
  valorAPagar: number;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  const [devQty, setDevQty] = useState("");
  const [devDate, setDevDate] = useState(today);
  const [devBusy, setDevBusy] = useState(false);

  const [payAmount, setPayAmount] = useState<number | undefined>(valorAPagar || undefined);
  const [payDate, setPayDate] = useState(today);
  const [payBusy, setPayBusy] = useState(false);

  async function devolver() {
    const qty = parseInt(devQty, 10);
    if (!qty || qty <= 0) return toast.error("Informe a quantidade devolvida.");
    setDevBusy(true);
    const res = await registrarDevolucaoHigienizacao({ id, quantity: qty, returnedDate: devDate });
    setDevBusy(false);
    if (res.ok) {
      toast.success("Devolução registrada.");
      setDevQty("");
      router.refresh();
    } else toast.error(res.error.message);
  }

  async function pagar() {
    if (!payAmount || payAmount <= 0) return toast.error("Informe o valor pago.");
    setPayBusy(true);
    const res = await registrarPagamentoHigienizacao({ id, amount: payAmount, paidDate: payDate });
    setPayBusy(false);
    if (res.ok) {
      toast.success("Pagamento registrado.");
      router.refresh();
    } else toast.error(res.error.message);
  }

  return (
    <div className="flex flex-col gap-4">
      {caixasAReceber > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Registrar devolução de caixas</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Qtd. devolvida</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={caixasAReceber}
                  value={devQty}
                  onChange={(e) => setDevQty(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Data</Label>
                <Input type="date" value={devDate} onChange={(e) => setDevDate(e.target.value)} />
              </div>
            </div>
            <Button onClick={devolver} disabled={devBusy}>
              {devBusy && <Loader2 className="animate-spin" />}
              Registrar devolução
            </Button>
          </CardContent>
        </Card>
      )}

      {valorAPagar > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Registrar pagamento ao higienizador</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Valor pago</Label>
                <CurrencyInput value={payAmount} onChange={setPayAmount} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Data</Label>
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </div>
            </div>
            <Button onClick={pagar} disabled={payBusy}>
              {payBusy && <Loader2 className="animate-spin" />}
              Registrar pagamento
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
