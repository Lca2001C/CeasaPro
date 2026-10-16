"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ArrowRight, Check, Package, Sprout, Store, Truck } from "lucide-react";
import { salvarEmpresa, concluirOnboarding } from "@/actions/config.actions";
import { criarFornecedor } from "@/actions/fornecedores.actions";
import { criarProduto } from "@/actions/produtos.actions";
import { SALE_UNIT_LABELS, toOptions } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { IconeRedondo } from "@/components/ui/icone-redondo";
import { cn } from "@/lib/cn";

import { chamarAction } from "@/lib/http/chamar-action";
/** Empresa → fornecedor → produto. */
const TOTAL_PASSOS = 3;
/** Nome curto de cada passo, no indicador do topo. */
const PASSOS = ["Empresa", "Fornecedor", "Produto"] as const;

export function OnboardingWizard({
  initialName,
  initialPhone,
  initialAddress,
}: {
  initialName: string;
  initialPhone: string;
  initialAddress: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  // Passo 1 — empresa
  const [tradeName, setTradeName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [address, setAddress] = useState(initialAddress);
  // Passo 2 — fornecedor
  const [supplierName, setSupplierName] = useState("");
  // Passo 3 — produto
  const [productName, setProductName] = useState("");
  const [saleUnit, setSaleUnit] = useState("CAIXA");

  async function saveCompany() {
    if (!tradeName.trim()) return toast.error("Informe o nome da empresa.");
    setBusy(true);
    /*
      Só as três chaves que este passo conhece — e nenhuma a mais.

      Mandar `legalName`, `cnpj` e `businessHours` como `null` fixo APAGAVA o
      que já estivesse preenchido em Configurações, e o wizard virou opcional e
      reabrível, então isso deixou de ser hipotético.

      A correção anterior devolvia esses campos num objeto `preservar`, o que
      resolvia o sintoma e trazia um problema menor junto: o formulário
      reescrevia valores lidos no carregamento da página, então uma alteração
      feita em outra aba no meio do caminho era desfeita por um passo que nem
      edita aquele campo. E cada campo novo da empresa precisava ser lembrado
      aqui, sob pena de voltar a ser apagado — foi o que aconteceu com `uf` e
      `establishmentType`.

      Hoje a correção está na RAIZ: `updateCompany` trata chave ausente como
      "não mexer" (`tests/integration/config-empresa-parcial.test.ts`). Este
      passo manda o que edita, e o resto fica intocado por construção.
    */
    const res = await chamarAction(() => salvarEmpresa({
      tradeName: tradeName.trim(),
      phone: phone || null,
      address: address || null,
    }));
    setBusy(false);
    if (res.ok) setStep(2);
    else toast.error(res.error.message);
  }

  async function saveSupplier(skip = false) {
    if (skip || !supplierName.trim()) return setStep(3);
    setBusy(true);
    const res = await chamarAction(() => criarFornecedor({
      name: supplierName.trim(),
      active: true,
      phone: null,
      address: null,
      notes: null,
    }));
    setBusy(false);
    if (res.ok) setStep(3);
    else toast.error(res.error.message);
  }

  async function saveProduct(skip = false) {
    if (skip || !productName.trim()) return finish();
    setBusy(true);
    const res = await chamarAction(() => criarProduto({
      name: productName.trim(),
      saleUnit: saleUnit as "CAIXA",
      active: true,
      qtyPerRecipient: null,
      recipientType: null,
      sackCapacity: null,
    }));
    setBusy(false);
    if (res.ok) finish();
    else toast.error(res.error.message);
  }

  async function finish() {
    setBusy(true);
    const res = await chamarAction(() => concluirOnboarding());
    setBusy(false);
    if (res.ok) {
      toast.success("Tudo pronto! Bem-vindo ao CeasaPro.");
      router.push("/dashboard");
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    // `main`: esta tela fica fora do AppShell e não herda marco nenhum.
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-5 px-4 py-8">
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 flex items-center gap-2 text-lg font-bold tracking-tight">
          <Sprout aria-hidden className="size-6 text-primary" />
          <span>
            Ceasa<span className="text-primary">Pro</span>
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Bem-vindo!</h1>
        {/* São 3 passos — o texto dizia "de 4" e deixava quem está começando
            esperando uma etapa que nunca vinha. */}
        <p className="mt-1 text-sm text-muted-foreground">
          Passo {step} de {TOTAL_PASSOS}
        </p>
        {/*
          Indicador numerado: cada passo com o seu nome, o feito ganha um ✓ e o
          atual um anel. O leitor de tela lê só o `aria-label` (os filhos de um
          `progressbar` são apresentacionais).
        */}
        <div
          className="mt-4 flex w-full max-w-xs items-start"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={TOTAL_PASSOS}
          aria-valuenow={step}
          aria-label={`Passo ${step} de ${TOTAL_PASSOS}`}
        >
          {PASSOS.map((rotulo, i) => {
            const n = i + 1;
            const feito = n < step;
            const atual = n === step;
            return (
              <Fragment key={rotulo}>
                {i > 0 && (
                  <span
                    className={cn(
                      "mt-[17px] h-0.5 flex-1 rounded-full motion-safe:transition-colors",
                      n <= step ? "bg-primary" : "bg-border",
                    )}
                  />
                )}
                <span className="flex w-20 shrink-0 flex-col items-center gap-1.5">
                  <span
                    className={cn(
                      "flex size-9 items-center justify-center rounded-full text-sm font-bold motion-safe:transition-colors",
                      feito && "bg-primary text-primary-foreground",
                      atual && "bg-primary/10 text-primary ring-2 ring-primary",
                      !feito && !atual && "bg-muted text-muted-foreground",
                    )}
                  >
                    {feito ? <Check className="size-4" /> : n}
                  </span>
                  <span
                    className={cn(
                      "text-xs font-semibold",
                      atual ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {rotulo}
                  </span>
                </span>
              </Fragment>
            );
          })}
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:p-7">
          {step === 1 && (
            <>
              <div className="flex items-center gap-3">
                <IconeRedondo>
                  <Store />
                </IconeRedondo>
                <h2 className="text-lg font-bold leading-tight tracking-tight">
                  Confirme os dados da sua empresa
                </h2>
              </div>
              {/* Os `<Label>` deste passo não apontam para os campos; sem
                  `aria-label` nenhum deles tem nome acessível. */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="onb-empresa">Nome da empresa</Label>
                <Input
                  id="onb-empresa"
                  aria-label="Nome da empresa"
                  value={tradeName}
                  onChange={(e) => setTradeName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="onb-telefone">Telefone</Label>
                <Input
                  id="onb-telefone"
                  aria-label="Telefone da empresa"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="onb-endereco">Endereço / Box</Label>
                <Input
                  id="onb-endereco"
                  aria-label="Endereço ou box"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
              <Button size="lg" onClick={saveCompany} disabled={busy} className="mt-1 w-full">
                {busy ? <Loader2 className="motion-safe:animate-spin" /> : <ArrowRight />} Continuar
              </Button>
            </>
          )}

          {step === 2 && (
            <>
              <div className="flex items-center gap-3">
                <IconeRedondo>
                  <Truck />
                </IconeRedondo>
                <h2 className="text-lg font-bold leading-tight tracking-tight">
                  Cadastre um fornecedor (opcional)
                </h2>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="onb-fornecedor">Nome do fornecedor</Label>
                <Input
                  id="onb-fornecedor"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row">
                <Button variant="outline" size="lg" className="sm:flex-1" onClick={() => saveSupplier(true)} disabled={busy}>
                  Pular
                </Button>
                <Button size="lg" className="sm:flex-1" onClick={() => saveSupplier()} disabled={busy}>
                  {busy ? <Loader2 className="motion-safe:animate-spin" /> : <ArrowRight />} Continuar
                </Button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="flex items-center gap-3">
                <IconeRedondo>
                  <Package />
                </IconeRedondo>
                <h2 className="text-lg font-bold leading-tight tracking-tight">
                  Cadastre um produto (opcional)
                </h2>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="onb-produto">Nome do produto</Label>
                <Input
                  id="onb-produto"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="onb-unidade">Unidade de venda</Label>
                <Select id="onb-unidade" value={saleUnit} onChange={(e) => setSaleUnit(e.target.value)}>
                  {toOptions(SALE_UNIT_LABELS).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row">
                <Button variant="outline" size="lg" className="sm:flex-1" onClick={() => saveProduct(true)} disabled={busy}>
                  Pular
                </Button>
                <Button size="lg" className="sm:flex-1" onClick={() => saveProduct()} disabled={busy}>
                  {busy ? <Loader2 className="motion-safe:animate-spin" /> : <Check />} Concluir
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
