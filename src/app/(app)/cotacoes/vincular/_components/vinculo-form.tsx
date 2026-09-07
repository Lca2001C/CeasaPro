"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Link2Off, Loader2 } from "lucide-react";
import { vincularCotacao, desvincularCotacao } from "@/actions/cotacoes.actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface DoBoletim {
  id: string;
  name: string;
}

interface ProdutoDoCliente {
  id: string;
  name: string;
  vinculo: DoBoletim | null;
  /** Ordenadas por probabilidade. Vazias quando já há vínculo. */
  sugestoes: DoBoletim[];
}

/**
 * Vínculo produto ↔ cotação, um produto por linha.
 *
 * As sugestões aparecem PRIMEIRO na lista, mas nada vem pré-selecionado: quem
 * confirma é a pessoa. "Tomate" é ambíguo entre tomate cereja, salada e
 * italiano, que têm preços diferentes — escolher por ela mostraria o preço
 * errado com cara de certo, e ninguém descobriria.
 */
export function VinculoForm({
  produtos,
  doBoletim,
}: {
  produtos: ProdutoDoCliente[];
  doBoletim: DoBoletim[];
}) {
  return (
    <div className="flex flex-col gap-2">
      {produtos.map((p) => (
        <LinhaDeProduto key={p.id} produto={p} doBoletim={doBoletim} />
      ))}
    </div>
  );
}

function LinhaDeProduto({
  produto,
  doBoletim,
}: {
  produto: ProdutoDoCliente;
  doBoletim: DoBoletim[];
}) {
  const router = useRouter();
  const [escolha, setEscolha] = useState("");
  const [busy, setBusy] = useState(false);

  async function vincular() {
    if (!escolha) return;
    setBusy(true);
    const res = await vincularCotacao({ productId: produto.id, ceasaProductId: escolha });
    setBusy(false);
    if (res.ok) {
      toast.success("Produto vinculado");
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  async function desvincular() {
    setBusy(true);
    const res = await desvincularCotacao({ productId: produto.id });
    setBusy(false);
    if (res.ok) {
      toast.success("Vínculo removido");
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  if (produto.vinculo) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{produto.name}</p>
          <Badge variant="success" className="mt-1 gap-1">
            <Check className="size-3" />
            {produto.vinculo.name}
          </Badge>
        </div>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={desvincular}>
          {busy ? <Loader2 className="animate-spin" /> : <Link2Off className="size-4" />}
          Desvincular
        </Button>
      </Card>
    );
  }

  // Sugestões no topo, o resto do catálogo abaixo — sem repetir as de cima.
  const idsSugeridos = new Set(produto.sugestoes.map((s) => s.id));
  const restante = doBoletim.filter((c) => !idsSugeridos.has(c.id));

  return (
    <Card className="flex flex-col gap-2 p-3">
      <p className="font-medium">{produto.name}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Select
            value={escolha}
            aria-label={`Cotação correspondente a ${produto.name}`}
            onChange={(e) => setEscolha(e.target.value)}
          >
            {/*
              Nada pré-selecionado, de propósito. Um valor inicial faria a pessoa
              clicar em "Vincular" sem ler, e o palpite viraria decisão dela sem
              ter sido.
            */}
            <option value="">Escolha a cotação correspondente…</option>
            {produto.sugestoes.length > 0 && (
              <optgroup label="Parecidos com este produto">
                {produto.sugestoes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Todos do boletim">
              {restante.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          </Select>
        </div>
        <Button type="button" size="sm" disabled={busy || !escolha} onClick={vincular}>
          {busy && <Loader2 className="animate-spin" />}
          Vincular
        </Button>
      </div>
    </Card>
  );
}
