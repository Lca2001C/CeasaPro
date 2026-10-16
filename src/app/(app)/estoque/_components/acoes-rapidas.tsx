"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { isoDateTz } from "@/lib/tz";
import { formatQty } from "@/lib/format";
import { calcularCustoDaCarga, nomeDaEmbalagem } from "@/lib/estoque/custo-carga";
import { CustosDaCarga } from "@/components/produtos/custos-da-carga";
import { QuantityInput } from "@/components/forms/quantity-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/** Os motivos de baixa — os mesmos da tela de ajuste, sem o acerto para mais. */
const MOTIVOS = [
  { value: "QUEBRA", label: "Quebra / Perda", tipo: "QUEBRA" },
  { value: "DOACAO", label: "Doação", tipo: "DOACAO" },
  { value: "AJUSTE_MENOS", label: "Acerto para menos (faltou)", tipo: "AJUSTE" },
] as const;
type Motivo = (typeof MOTIVOS)[number]["value"];

/**
 * Entrada e baixa rápidas, no cartão do produto.
 *
 * A quantidade vem primeiro, no próprio cartão; o botão abre só o que falta
 * decidir. A ENTRADA é uma compra de um item (`/api/compras`): o custo da
 * mercadoria vira o preço unitário e a descarga vira o frete, que a compra
 * rateia no custo — o mesmo custo por unidade que o card mostra. Como toda
 * compra, ela lança a conta em Despesas. A BAIXA é o ajuste de estoque
 * (`/api/estoque/ajuste`) com o motivo escolhido.
 */
export function AcoesRapidas({
  productId,
  nome,
  saleUnit,
  saldo,
  fornecedores,
  podeEntrar,
}: {
  productId: string;
  nome: string;
  saleUnit: string;
  saldo: number;
  fornecedores: { id: string; name: string }[];
  /** Produto inativo não recebe compra. */
  podeEntrar: boolean;
}) {
  const router = useRouter();
  const [quantidade, setQuantidade] = useState<number | undefined>(undefined);
  const [painel, setPainel] = useState<"entrada" | "baixa" | null>(null);
  const [mercadoria, setMercadoria] = useState<number | null>(null);
  const [descarga, setDescarga] = useState<number | null>(null);
  const [fornecedor, setFornecedor] = useState("");
  const [motivo, setMotivo] = useState<Motivo>("QUEBRA");
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [salvando, setSalvando] = useState(false);
  // Trava síncrona contra toque duplo: `salvando` só desabilita no próximo render.
  const enviando = useRef(false);
  const chaveDaEntrada = useRef<string | null>(null);

  const qtd = quantidade ?? 0;
  const prefixo = `rapida-${productId}`;

  function abrir(qual: "entrada" | "baixa") {
    if (qtd <= 0) {
      toast.error("Informe a quantidade primeiro.");
      document.getElementById(`${prefixo}-qtd`)?.focus();
      return;
    }
    setErro(undefined);
    setPainel((atual) => (atual === qual ? null : qual));
  }

  function terminar(mensagem: string) {
    toast.success(mensagem);
    setQuantidade(undefined);
    setMercadoria(null);
    setDescarga(null);
    setPainel(null);
    chaveDaEntrada.current = null;
    router.refresh();
  }

  async function confirmarEntrada() {
    if (enviando.current) return;
    const custo = calcularCustoDaCarga(qtd, mercadoria, descarga);
    if (custo.custoUnitario == null) {
      setErro(`Informe quanto custou cada ${nomeDaEmbalagem(saleUnit, 1)}.`);
      return;
    }
    enviando.current = true;
    setSalvando(true);
    chaveDaEntrada.current ??= crypto.randomUUID();
    const res = await apiPost<{ id: string }>("/api/compras", {
      idempotencyKey: chaveDaEntrada.current,
      supplierId: fornecedor || null,
      purchaseDate: isoDateTz(),
      freight: custo.totalDescarga,
      notes: null,
      items: [{ productId, quantity: qtd, unitPrice: mercadoria ?? 0 }],
      pagamento: { status: "PAGO" },
    });
    enviando.current = false;
    setSalvando(false);
    if (res.ok) terminar(`Entrada de ${formatQty(qtd)} registrada.`);
    else toast.error(res.error.message);
  }

  async function confirmarBaixa() {
    if (enviando.current) return;
    if (qtd > saldo) {
      setErro(`Só há ${formatQty(saldo)} ${nomeDaEmbalagem(saleUnit, saldo)} em estoque.`);
      return;
    }
    const escolhido = MOTIVOS.find((m) => m.value === motivo) ?? MOTIVOS[0];
    enviando.current = true;
    setSalvando(true);
    const res = await apiPost("/api/estoque/ajuste", {
      productId,
      type: escolhido.tipo,
      quantity: escolhido.tipo === "AJUSTE" ? -qtd : qtd,
      reason: null,
    });
    enviando.current = false;
    setSalvando(false);
    if (res.ok) terminar(`Baixa de ${formatQty(qtd)} registrada.`);
    else toast.error(res.error.message);
  }

  return (
    <div className="mt-3 flex flex-col gap-3 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-24">
          <QuantityInput
            id={`${prefixo}-qtd`}
            aria-label={`Quantidade de ${nome}`}
            placeholder="Qtd"
            value={quantidade}
            onChange={(v) => {
              setQuantidade(v);
              setErro(undefined);
              chaveDaEntrada.current = null;
            }}
          />
        </div>
        {podeEntrar && (
          <Button
            type="button"
            size="sm"
            variant="success"
            aria-expanded={painel === "entrada"}
            aria-label={`Entrada de ${nome}`}
            onClick={() => abrir("entrada")}
          >
            <Plus /> Entrada
          </Button>
        )}
        {saldo > 0 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={painel === "baixa"}
            aria-label={`Dar baixa em ${nome}`}
            onClick={() => abrir("baixa")}
          >
            <Minus /> Dar baixa
          </Button>
        )}
      </div>

      {painel === "entrada" && (
        <CustosDaCarga
          idPrefixo={prefixo}
          titulo="Custos desta entrada"
          descricao={`Quanto custou cada ${nomeDaEmbalagem(saleUnit, 1)} que está chegando. A entrada vira uma compra, com a conta lançada em Despesas como paga.`}
          quantidade={qtd}
          saleUnit={saleUnit}
          mercadoria={mercadoria}
          descarga={descarga}
          onMercadoria={(v) => {
            setMercadoria(v);
            setErro(undefined);
            chaveDaEntrada.current = null;
          }}
          onDescarga={(v) => {
            setDescarga(v);
            setErro(undefined);
            chaveDaEntrada.current = null;
          }}
          erro={erro}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${prefixo}-fornecedor`}>
              Fornecedor <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Select
              id={`${prefixo}-fornecedor`}
              value={fornecedor}
              onChange={(e) => {
                setFornecedor(e.target.value);
                chaveDaEntrada.current = null;
              }}
            >
              <option value="">Sem fornecedor</option>
              {fornecedores.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </div>
          <Button type="button" variant="success" onClick={confirmarEntrada} disabled={salvando}>
            {salvando && <Loader2 className="animate-spin" />}
            Confirmar entrada
          </Button>
        </CustosDaCarga>
      )}

      {painel === "baixa" && (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${prefixo}-motivo`}>Motivo da baixa</Label>
            <Select
              id={`${prefixo}-motivo`}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value as Motivo)}
            >
              {MOTIVOS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
          {erro && <span className="text-xs text-destructive">{erro}</span>}
          <Button type="button" variant="outline" onClick={confirmarBaixa} disabled={salvando}>
            {salvando && <Loader2 className="animate-spin" />}
            Confirmar baixa de {formatQty(qtd)} {nomeDaEmbalagem(saleUnit, qtd)}
          </Button>
        </div>
      )}
    </div>
  );
}
