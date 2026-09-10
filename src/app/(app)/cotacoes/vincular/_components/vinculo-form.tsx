"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Link2Off, Loader2 } from "lucide-react";
import {
  vincularEmLoteCotacao,
  desvincularCotacao,
} from "@/actions/cotacoes.actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { SALE_UNIT_LABELS } from "@/lib/labels";
import { rotuloDeEmbalagem } from "@/lib/cotacoes/embalagem";
import type { SaleUnit } from "@prisma/client";

interface ItemDoBoletim {
  id: string;
  name: string;
  /** As embalagens em que a praça cota este item. */
  unidades: string[];
}

interface Sugestao {
  item: ItemDoBoletim;
  /** 0 a 1. Só ordena e decide a pré-marcação de 1 — ver `sugerirVinculos`. */
  escore: number;
  unidadeSugerida: string | null;
}

interface ProdutoDoCliente {
  id: string;
  name: string;
  saleUnit: SaleUnit;
  vinculo: { id: string; name: string; unit: string | null } | null;
  /** Ordenadas por probabilidade. Vazias quando já há vínculo. */
  sugestoes: Sugestao[];
}

/**
 * "Qualquer embalagem" precisa de um valor que não seja `""`.
 *
 * String vazia é uma embalagem DE VERDADE no boletim — é o que a praça manual
 * grava quando o boletim não traz a coluna. Usar `""` para "qualquer" tornaria
 * os dois indistinguíveis no `<select>`, e o cliente que escolhesse "a linha sem
 * embalagem" receberia um vínculo que casa todas.
 */
const QUALQUER = "__QUALQUER__";

/** Escore em que o nome normalizado é idêntico — ver `sugerirVinculos`. */
const ESCORE_IDENTICO = 1;

interface Escolha {
  marcado: boolean;
  ceasaProductId: string;
  /** `null` = qualquer embalagem. */
  unit: string | null;
}

/**
 * Revisão de vínculos: a lista inteira de uma vez, confirmada em um clique.
 *
 * Antes esta tela era um produto por vez — escolher, confirmar, esperar o
 * recarregar, repetir. Quem contrata o módulo com quarenta produtos cadastrados
 * fazia isso quarenta vezes, e a maior parte das linhas era o mesmo nome dos dois
 * lados.
 *
 * O que mudou é o ATRITO, não a decisão. Continua valendo que sugestão não vira
 * vínculo sozinha: as linhas em que o nome normalizado é IDÊNTICO vêm marcadas,
 * as demais vêm em branco, e nada é gravado até o clique em "Confirmar". A
 * diferença entre pré-marcar e auto-vincular é que a primeira é uma proposta que
 * a pessoa vê e pode desmarcar.
 *
 * E a pré-marcação nunca escolhe EMBALAGEM: quando o item tem mais de uma, ela
 * propõe "qualquer embalagem", que é literalmente "o cliente não escolheu".
 * Marcar `CX 20 KG` por conta própria seria decidir em silêncio a parte que muda
 * o preço em uma ordem de grandeza.
 */
export function VinculoForm({
  produtos,
  doBoletim,
}: {
  produtos: ProdutoDoCliente[];
  doBoletim: ItemDoBoletim[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const semVinculo = useMemo(() => produtos.filter((p) => !p.vinculo), [produtos]);
  const comVinculo = useMemo(() => produtos.filter((p) => p.vinculo), [produtos]);

  const [escolhas, setEscolhas] = useState<Record<string, Escolha>>(() => {
    const inicial: Record<string, Escolha> = {};
    for (const p of semVinculo) {
      const certa = p.sugestoes.find((s) => s.escore >= ESCORE_IDENTICO);
      inicial[p.id] = certa
        ? {
            marcado: true,
            ceasaProductId: certa.item.id,
            // Uma embalagem só: não há o que decidir, é ela. Mais de uma:
            // "qualquer", e o cliente estreita quando quiser.
            unit: certa.item.unidades.length === 1 ? certa.item.unidades[0] : null,
          }
        : { marcado: false, ceasaProductId: "", unit: null };
    }
    return inicial;
  });

  const porId = useMemo(() => new Map(doBoletim.map((c) => [c.id, c])), [doBoletim]);
  const marcados = semVinculo.filter(
    (p) => escolhas[p.id]?.marcado && escolhas[p.id]?.ceasaProductId,
  );

  function mudar(produtoId: string, patch: Partial<Escolha>) {
    setEscolhas((atual) => ({ ...atual, [produtoId]: { ...atual[produtoId], ...patch } }));
  }

  function escolherItem(produto: ProdutoDoCliente, ceasaProductId: string) {
    const item = porId.get(ceasaProductId);
    const sugerida = produto.sugestoes.find((s) => s.item.id === ceasaProductId)?.unidadeSugerida;
    mudar(produto.id, {
      ceasaProductId,
      // Item escolhido à mão: a embalagem provável já vem selecionada no
      // `<select>`, VISÍVEL, porque a pessoa está com a atenção exatamente aqui.
      // Uma embalagem só dispensa a escolha.
      unit:
        item && item.unidades.length === 1
          ? item.unidades[0]
          : (sugerida ?? null),
      // Escolher o item é a intenção de vincular; deixar desmarcado obrigaria
      // dois cliques para dizer a mesma coisa.
      marcado: Boolean(ceasaProductId),
    });
  }

  async function confirmar() {
    if (marcados.length === 0) return;
    setBusy(true);
    const res = await vincularEmLoteCotacao({
      itens: marcados.map((p) => ({
        productId: p.id,
        ceasaProductId: escolhas[p.id].ceasaProductId,
        unit: escolhas[p.id].unit,
      })),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(
        marcados.length === 1 ? "Produto vinculado" : `${marcados.length} produtos vinculados`,
      );
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {semVinculo.map((p) => (
        <LinhaSemVinculo
          key={p.id}
          produto={p}
          doBoletim={doBoletim}
          escolha={escolhas[p.id]}
          item={porId.get(escolhas[p.id]?.ceasaProductId ?? "") ?? null}
          onMarcar={(marcado) => mudar(p.id, { marcado })}
          onItem={(id) => escolherItem(p, id)}
          onUnidade={(unit) => mudar(p.id, { unit })}
        />
      ))}

      {semVinculo.length > 0 && (
        /*
          A barra de confirmação fica FIXA no rodapé no celular: a lista tem
          dezenas de linhas, e um botão no fim obrigaria a rolar tudo de volta
          para descobrir que ele existe.
        */
        <div className="sticky bottom-0 -mx-1 border-t bg-background/95 px-1 py-3 backdrop-blur">
          <Button
            type="button"
            className="w-full"
            disabled={busy || marcados.length === 0}
            onClick={confirmar}
          >
            {busy && <Loader2 className="animate-spin" />}
            {marcados.length === 0
              ? "Marque os produtos para vincular"
              : marcados.length === 1
                ? "Confirmar 1 vínculo"
                : `Confirmar ${marcados.length} vínculos`}
          </Button>
        </div>
      )}

      {comVinculo.map((p) => (
        <LinhaVinculada key={p.id} produto={p} busy={busy} />
      ))}
    </div>
  );
}

function LinhaSemVinculo({
  produto,
  doBoletim,
  escolha,
  item,
  onMarcar,
  onItem,
  onUnidade,
}: {
  produto: ProdutoDoCliente;
  doBoletim: ItemDoBoletim[];
  escolha: Escolha | undefined;
  item: ItemDoBoletim | null;
  onMarcar: (marcado: boolean) => void;
  onItem: (ceasaProductId: string) => void;
  onUnidade: (unit: string | null) => void;
}) {
  // Sugestões no topo, o resto do catálogo abaixo — sem repetir as de cima.
  const idsSugeridos = new Set(produto.sugestoes.map((s) => s.item.id));
  const restante = doBoletim.filter((c) => !idsSugeridos.has(c.id));

  return (
    <Card className="flex flex-col gap-2 p-3">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0"
          checked={escolha?.marcado ?? false}
          onChange={(e) => onMarcar(e.target.checked)}
          aria-label={`Vincular ${produto.name}`}
        />
        <span className="min-w-0">
          <span className="block font-medium [overflow-wrap:anywhere]">{produto.name}</span>
          <span className="block text-xs text-muted-foreground">
            você vende por {SALE_UNIT_LABELS[produto.saleUnit]}
          </span>
        </span>
      </label>

      <Select
        value={escolha?.ceasaProductId ?? ""}
        aria-label={`Cotação correspondente a ${produto.name}`}
        onChange={(e) => onItem(e.target.value)}
      >
        <option value="">Escolha a cotação correspondente…</option>
        {produto.sugestoes.length > 0 && (
          <optgroup label="Parecidos com este produto">
            {produto.sugestoes.map((s) => (
              <option key={s.item.id} value={s.item.id}>
                {s.item.name}
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

      {/* A embalagem só é pergunta quando há mais de uma resposta possível. */}
      {item && item.unidades.length > 1 && (
        <Select
          value={escolha?.unit ?? QUALQUER}
          aria-label={`Embalagem de ${produto.name} no boletim`}
          onChange={(e) => onUnidade(e.target.value === QUALQUER ? null : e.target.value)}
        >
          <option value={QUALQUER}>Qualquer embalagem</option>
          {item.unidades.map((u) => (
            <option key={u} value={u}>
              {rotuloDeEmbalagem(u)}
            </option>
          ))}
        </Select>
      )}
    </Card>
  );
}

function LinhaVinculada({ produto, busy }: { produto: ProdutoDoCliente; busy: boolean }) {
  const router = useRouter();
  const [removendo, setRemovendo] = useState(false);

  async function desvincular() {
    setRemovendo(true);
    const res = await desvincularCotacao({ productId: produto.id });
    setRemovendo(false);
    if (res.ok) {
      toast.success("Vínculo removido");
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <Card className="flex flex-wrap items-center justify-between gap-2 p-3">
      <div className="min-w-0">
        <p className="truncate font-medium">{produto.name}</p>
        <Badge variant="success" className="mt-1 gap-1">
          <Check className="size-3" />
          {produto.vinculo?.name}
          {produto.vinculo?.unit != null && ` · ${rotuloDeEmbalagem(produto.vinculo.unit)}`}
        </Badge>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy || removendo}
        onClick={desvincular}
      >
        {removendo ? <Loader2 className="animate-spin" /> : <Link2Off className="size-4" />}
        Desvincular
      </Button>
    </Card>
  );
}
