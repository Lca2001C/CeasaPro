"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ArrowRight, Check } from "lucide-react";
import { salvarEmpresa, concluirOnboarding } from "@/actions/config.actions";
import { criarFornecedor } from "@/actions/fornecedores.actions";
import { criarProduto } from "@/actions/produtos.actions";
import { SALE_UNIT_LABELS, toOptions } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";

export function OnboardingWizard({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  // Passo 1 — empresa
  const [tradeName, setTradeName] = useState(initialName);
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  // Passo 2 — fornecedor
  const [supplierName, setSupplierName] = useState("");
  // Passo 3 — produto
  const [productName, setProductName] = useState("");
  const [saleUnit, setSaleUnit] = useState("CAIXA");

  async function saveCompany() {
    if (!tradeName.trim()) return toast.error("Informe o nome da empresa.");
    setBusy(true);
    const res = await salvarEmpresa({
      tradeName: tradeName.trim(),
      phone: phone || null,
      address: address || null,
      legalName: null,
      cnpj: null,
      businessHours: null,
    });
    setBusy(false);
    if (res.ok) setStep(2);
    else toast.error(res.error.message);
  }

  async function saveSupplier(skip = false) {
    if (skip || !supplierName.trim()) return setStep(3);
    setBusy(true);
    const res = await criarFornecedor({
      name: supplierName.trim(),
      active: true,
      phone: null,
      address: null,
      notes: null,
    });
    setBusy(false);
    if (res.ok) setStep(3);
    else toast.error(res.error.message);
  }

  async function saveProduct(skip = false) {
    if (skip || !productName.trim()) return finish();
    setBusy(true);
    const res = await criarProduto({
      name: productName.trim(),
      saleUnit: saleUnit as "CAIXA",
      active: true,
      qtyPerRecipient: null,
      recipientType: null,
      sackCapacity: null,
    });
    setBusy(false);
    if (res.ok) finish();
    else toast.error(res.error.message);
  }

  async function finish() {
    setBusy(true);
    const res = await concluirOnboarding();
    setBusy(false);
    if (res.ok) {
      toast.success("Tudo pronto! Bem-vindo ao CeasaPro.");
      router.push("/dashboard");
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-primary">Bem-vindo!</h1>
        <p className="text-sm text-muted-foreground">Passo {step} de 4</p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          {step === 1 && (
            <>
              <p className="font-medium">Confirme os dados da sua empresa</p>
              <div className="flex flex-col gap-1.5">
                <Label>Nome da empresa</Label>
                <Input value={tradeName} onChange={(e) => setTradeName(e.target.value)} autoFocus />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Telefone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Endereço / Box</Label>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <Button onClick={saveCompany} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />} Continuar
              </Button>
            </>
          )}

          {step === 2 && (
            <>
              <p className="font-medium">Cadastre um fornecedor (opcional)</p>
              <div className="flex flex-col gap-1.5">
                <Label>Nome do fornecedor</Label>
                <Input
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={() => saveSupplier(true)} disabled={busy}>
                  Pular
                </Button>
                <Button className="flex-1" onClick={() => saveSupplier()} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />} Continuar
                </Button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <p className="font-medium">Cadastre um produto (opcional)</p>
              <div className="flex flex-col gap-1.5">
                <Label>Nome do produto</Label>
                <Input
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Unidade de venda</Label>
                <Select value={saleUnit} onChange={(e) => setSaleUnit(e.target.value)}>
                  {toOptions(SALE_UNIT_LABELS).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={() => saveProduct(true)} disabled={busy}>
                  Pular
                </Button>
                <Button className="flex-1" onClick={() => saveProduct()} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <Check />} Concluir
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
