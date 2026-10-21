"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PackagePlus, Warehouse } from "lucide-react";
import { toast } from "sonner";
import {
  ativarEstoqueEmbalagem,
  desfazerEntradaEmbalagem,
  registrarEntradaEmbalagem,
} from "@/actions/embalagens.actions";
import { chamarAction } from "@/lib/http/chamar-action";
import { nivelEstoque } from "@/lib/estoque/nivel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/cn";

/**
 * Linha de um tipo de embalagem, com saldo e as ações de estoque.
 *
 * O controle começa DESLIGADO por tipo: quem já vendia embalagem nunca
 * registrou entrada, e ligar tudo de uma vez mostraria saldo negativo em
 * todo canto — o que seria falta de histórico, não falta de embalagem. Aqui o
 * dono liga informando quanto tem hoje, e a partir daí a venda dá baixa.
 */
export function EstoqueTipo({
  id,
  nome,
  controlaEstoque,
  saldo,
}: {
  id: string;
  nome: string;
  controlaEstoque: boolean;
  saldo: number | null;
}) {
  const router = useRouter();
  const [ligando, setLigando] = useState(false);
  const [entrando, setEntrando] = useState(false);
  const [quantidade, setQuantidade] = useState("");
  const [custo, setCusto] = useState("");
  const [pending, start] = useTransition();

  const nivel = saldo === null ? null : nivelEstoque(saldo);

  /** Custo de cada embalagem — forma o custo médio que a venda desconta do lucro. */
  const custoInformado = () => {
    const n = Number(custo.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const abrir = (setter: (v: boolean) => void) => {
    setQuantidade("");
    setCusto("");
    setter(true);
  };

  function ligar() {
    const qtd = parseInt(quantidade, 10);
    if (Number.isNaN(qtd) || qtd < 0) return toast.error("Informe quantas você tem hoje.");
    const custoUnitario = custoInformado();
    if (qtd > 0 && custoUnitario === null) return toast.error("Informe quanto custou cada uma.");
    start(async () => {
      const res = await ativarEstoqueEmbalagem({
        packagingTypeId: id,
        quantidadeAtual: qtd,
        ...(qtd > 0 && custoUnitario !== null ? { custoUnitario } : {}),
      });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success(`Controle de estoque ligado para ${nome}.`);
      setLigando(false);
      setQuantidade("");
      router.refresh();
    });
  }

  function entrada() {
    const qtd = parseInt(quantidade, 10);
    if (!qtd || qtd <= 0) return toast.error("Informe a quantidade que entrou.");
    const unitCost = custoInformado();
    if (unitCost === null) return toast.error("Informe quanto custou cada uma.");
    start(async () => {
      const res = await registrarEntradaEmbalagem({ packagingTypeId: id, quantity: qtd, unitCost });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      const entradaId = res.data.id;
      // Lançou errado? Desfazer fica à mão (a regra de 24 h vale no servidor);
      // a conta da compra gerada junto é cancelada também.
      toast.success(`+${qtd} ${nome} no estoque. A compra entrou nas contas pagas.`, {
        action: {
          label: "Desfazer",
          onClick: async () => {
            const r = await chamarAction(() => desfazerEntradaEmbalagem({ id: entradaId }));
            if (r.ok) toast.success("Entrada desfeita.");
            else toast.error(r.error.message);
            router.refresh();
          },
        },
      });
      setEntrando(false);
      setQuantidade("");
      router.refresh();
    });
  }

  return (
    <>
      <Card
        className={cn(
          "flex items-center justify-between gap-2 p-3",
          nivel === "acabando" && "border-warning/50 bg-warning/5",
        )}
      >
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{nome}</span>
            {nivel === "acabando" && <Badge variant="warning">Acabando</Badge>}
            {nivel === "zerado" && <Badge variant="secondary">Sem estoque</Badge>}
          </span>
          <span className="block text-xs text-muted-foreground">
            {controlaEstoque ? `${saldo ?? 0} em estoque` : "Sem controle de estoque"}
          </span>
        </span>

        {controlaEstoque ? (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => abrir(setEntrando)}
          >
            <PackagePlus className="size-4" />
            <span className="hidden sm:inline">Entrada</span>
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => abrir(setLigando)}
          >
            <Warehouse className="size-4" />
            <span className="hidden sm:inline">Controlar</span>
          </Button>
        )}
      </Card>

      <Dialog open={ligando} onOpenChange={(o) => !o && setLigando(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Controlar estoque de {nome}</DialogTitle>
            <DialogDescription>
              A partir de agora cada venda desabate do saldo, e o sistema avisa quando
              estiver acabando. Informe <b>quantas você tem hoje</b> — esse número vira o
              saldo inicial.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`qtd-inicial-${id}`}>Quantidade em estoque hoje</Label>
            <Input
              id={`qtd-inicial-${id}`}
              type="number"
              inputMode="numeric"
              min={0}
              autoFocus
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
            />
          </div>
          <CampoCusto id={`custo-inicial-${id}`} valor={custo} onChange={setCusto} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setLigando(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={ligar} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Ligar controle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={entrando} onOpenChange={(o) => !o && setEntrando(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Entrada de {nome}</DialogTitle>
            <DialogDescription>
              Quantas embalagens chegaram? O saldo atual é <b>{saldo ?? 0}</b>.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`qtd-entrada-${id}`}>Quantidade que entrou</Label>
            <Input
              id={`qtd-entrada-${id}`}
              type="number"
              inputMode="numeric"
              min={1}
              autoFocus
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
            />
          </div>
          <CampoCusto id={`custo-entrada-${id}`} valor={custo} onChange={setCusto} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEntrando(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={entrada} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Registrar entrada
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Custo de UMA embalagem. É dele que sai o custo médio que a venda desconta do lucro. */
function CampoCusto({
  id,
  valor,
  onChange,
}: {
  id: string;
  valor: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Quanto custou cada uma (R$)</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        placeholder="Ex.: 1,50"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="text-xs text-muted-foreground">
        Com o custo, o lucro do mês desconta o que a embalagem vendida custou.
      </span>
    </div>
  );
}
