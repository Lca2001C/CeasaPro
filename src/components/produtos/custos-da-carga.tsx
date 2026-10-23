"use client";

import type { ReactNode } from "react";
import { Package } from "lucide-react";
import { Label } from "@/components/ui/label";
import { CurrencyInput } from "@/components/forms/currency-input";
import { formatBRL, formatQty } from "@/lib/format";
import { calcularCustoDaCarga, nomeDaEmbalagem } from "@/lib/estoque/custo-carga";

/**
 * "Custos desta carga" — o que custou cada unidade que entra no estoque.
 *
 * Usado no cadastro (estoque inicial) e na entrada rápida do Estoque.
 * Mercadoria e descarga são somadas por unidade; a soma vira o custo médio e o
 * CMV das vendas. `children` entra antes do resumo (ex.: o fornecedor).
 */
export function CustosDaCarga({
  quantidade,
  saleUnit,
  mercadoria,
  descarga,
  onMercadoria,
  onDescarga,
  erro,
  titulo = "Custos desta carga inicial",
  descricao,
  idPrefixo = "produto",
  semCusto = false,
  onSemCusto,
  children,
}: {
  quantidade: number;
  saleUnit: string;
  mercadoria: number | null;
  descarga: number | null;
  onMercadoria: (v: number | null) => void;
  onDescarga: (v: number | null) => void;
  erro?: string;
  titulo?: string;
  descricao?: string;
  /** Prefixo dos `id` dos campos: a lista do Estoque tem um card por produto. */
  idPrefixo?: string;
  /** Só o cadastro do produto oferece pular o custo. A entrada rápida vira compra. */
  semCusto?: boolean;
  onSemCusto?: (marcado: boolean) => void;
  children?: ReactNode;
}) {
  const custo = calcularCustoDaCarga(quantidade, mercadoria, descarga);
  const uma = nomeDaEmbalagem(saleUnit, 1);
  const varias = `${formatQty(quantidade)} ${nomeDaEmbalagem(saleUnit, quantidade)}`;
  const idTitulo = `${idPrefixo}-custos-titulo`;

  return (
    <section
      aria-labelledby={idTitulo}
      className="flex flex-col gap-3 rounded-lg border border-warning/50 bg-warning/10 p-3"
    >
      <div>
        <h3 id={idTitulo} className="flex items-center gap-2 text-sm font-semibold">
          <Package className="size-4 text-warning" />
          {titulo}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {semCusto
            ? `As ${varias} entram no estoque. Lucro, margem, CMV e valor em estoque não usam esta carga, e uma compra seguinte não espalha o preço nela.`
            : (descricao ??
              `Quanto custou cada ${uma} que já está no box. É com esse custo que o sistema calcula o lucro das primeiras vendas.`)}
        </p>
      </div>

      {onSemCusto && (
        <label className="flex items-start gap-3 rounded-md border bg-background p-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-5 shrink-0"
            checked={semCusto}
            onChange={(e) => onSemCusto(e.target.checked)}
          />
          <span>
            <span className="font-medium">Não cadastrar o custo agora</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              A quantidade entra no estoque. Lucro, margem, CMV e valor em estoque não usam esta
              carga.
            </span>
          </span>
        </label>
      )}

      {!semCusto && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefixo}-custo-mercadoria`}>
              Custo da mercadoria (R$ por {uma})
            </Label>
            <CurrencyInput
              id={`${idPrefixo}-custo-mercadoria`}
              placeholder="R$ 0,00"
              value={mercadoria}
              onChange={(v) => onMercadoria(v ?? null)}
            />
            <span className="text-xs text-muted-foreground">Produção + embalagem + transporte</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefixo}-custo-descarga`}>
              Custo de descarregamento (R$ por {uma})
            </Label>
            <CurrencyInput
              id={`${idPrefixo}-custo-descarga`}
              placeholder="R$ 0,00"
              value={descarga}
              onChange={(v) => onDescarga(v ?? null)}
            />
            <span className="text-xs text-muted-foreground">
              Em geral R$ 0,50 (caixa leve) ou R$ 1,00 (caixa pesada, de 20 kg ou mais)
            </span>
          </div>
        </>
      )}

      {children}

      {erro && <span className="text-xs text-destructive">{erro}</span>}

      {!semCusto && custo.custoUnitario != null && (
        <dl className="flex flex-col gap-1 rounded-md border bg-background p-2 text-xs">
          <div className="flex justify-between gap-2">
            <dt>
              {varias} × {formatBRL(mercadoria ?? 0)} (mercadoria)
            </dt>
            <dd className="tabular-nums">{formatBRL(custo.totalMercadoria)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>
              {varias} × {formatBRL(descarga ?? 0)} (descarga)
            </dt>
            <dd className="tabular-nums">{formatBRL(custo.totalDescarga)}</dd>
          </div>
          <div className="flex justify-between gap-2 border-t pt-1 font-semibold">
            <dt>Total da carga</dt>
            <dd className="tabular-nums" data-testid="custo-carga-total">
              {formatBRL(custo.total)}
            </dd>
          </div>
          <div className="flex justify-between gap-2 font-semibold">
            <dt>Custo por {uma}</dt>
            <dd className="tabular-nums" data-testid="custo-carga-unitario">
              {formatBRL(custo.custoUnitario)}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
