"use client";

import { isoDateTz } from "@/lib/tz";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PackageX } from "lucide-react";
import { toast } from "sonner";
import {
  registrarDevolucaoHigienizacao,
  registrarPagamentoHigienizacao,
  registrarPerdaHigienizacao,
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
  cleanerName,
}: {
  id: string;
  caixasAReceber: number;
  valorAPagar: number;
  /** Nome do higienizador — vai junto no atalho de registrar perda. */
  cleanerName?: string;
}) {
  const router = useRouter();
  const today = isoDateTz();

  const [devQty, setDevQty] = useState("");
  const [devDate, setDevDate] = useState(today);
  const [devBusy, setDevBusy] = useState(false);

  const [payAmount, setPayAmount] = useState<number | undefined>(valorAPagar || undefined);
  const [payDate, setPayDate] = useState(today);
  const [payBusy, setPayBusy] = useState(false);

  const [perdaQty, setPerdaQty] = useState("");
  const [perdaDate, setPerdaDate] = useState(today);
  const [perdaBusy, setPerdaBusy] = useState(false);

  async function registrarPerda() {
    const qty = parseInt(perdaQty, 10);
    if (!qty || qty <= 0) return toast.error("Informe quantas caixas se perderam.");
    setPerdaBusy(true);
    const res = await registrarPerdaHigienizacao({
      id,
      quantity: qty,
      movementDate: perdaDate,
    });
    setPerdaBusy(false);
    if (res.ok) {
      toast.success(`${qty} caixa(s) registrada(s) como perdida(s).`);
      setPerdaQty("");
      router.refresh();
    } else toast.error(res.error.message);
  }

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

            {/* Enviou 50, voltaram 47: sem isto as 3 restantes ficariam para
                sempre "aguardando devolução" — o painel cobrando uma devolução
                que não vai acontecer, e o lote nunca fechando. */}
            <div className="border-t pt-3">
              <p className="mb-2 text-xs text-muted-foreground">
                Faltou caixa voltar? Se {cleanerName ? <b>{cleanerName}</b> : "o higienizador"}{" "}
                perdeu ou quebrou alguma, registre a perda para o lote fechar.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Qtd. perdida</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={caixasAReceber}
                    value={perdaQty}
                    onChange={(e) => setPerdaQty(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Data</Label>
                  <Input
                    type="date"
                    value={perdaDate}
                    onChange={(e) => setPerdaDate(e.target.value)}
                  />
                </div>
              </div>
              <Button
                variant="outline"
                className="mt-2 w-full text-destructive"
                onClick={registrarPerda}
                disabled={perdaBusy}
              >
                {perdaBusy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <PackageX className="size-4" />
                )}
                Registrar caixas perdidas
              </Button>
            </div>
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
