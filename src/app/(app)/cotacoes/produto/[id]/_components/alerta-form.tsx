"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { removerAlertaDeCotacao, salvarAlertaDeCotacao } from "@/actions/cotacoes.actions";
import { VARIACAO_SUGERIDA } from "@/lib/cotacoes/alerta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * "Me avise se este item mexer" — na tela do próprio produto.
 *
 * Fica aqui, e não numa tela de "favoritos" separada, porque é onde a pessoa já
 * está quando tem a informação para decidir: acabou de ver o histórico, a média
 * por mês e o preço nas outras praças. Mandá-la a outro lugar para configurar
 * significaria configurar sem esses números na frente.
 *
 * O limiar já vem preenchido com um valor útil. Um campo vazio obrigaria cada
 * usuário a inventar um número sobre um assunto em que ele não tem intuição
 * ("10% é muito ou pouco para tomate?"), e o custo de errar para baixo é um
 * alarme que toca todo dia.
 */
export function AlertaForm({
  ceasaProductId,
  unit,
  atual,
}: {
  ceasaProductId: string;
  unit: string;
  atual: { variacaoMinima: string; precoTeto: string | null; precoPiso: string | null } | null;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [variacao, setVariacao] = useState(atual?.variacaoMinima ?? String(VARIACAO_SUGERIDA));
  const [teto, setTeto] = useState(atual?.precoTeto ?? "");
  const [piso, setPiso] = useState(atual?.precoPiso ?? "");
  /*
    Erro POR CAMPO, e não só o toast.

    A validação devolve `{ message: "Verifique os campos destacados.", fields }`,
    e mostrar só a mensagem manda a pessoa procurar qual campo, sem dizer o que
    está errado. Com três campos numéricos parecidos e uma regra invisível
    entre dois deles (o piso tem de ser menor que o teto), isso é um beco.
  */
  const [erros, setErros] = useState<Record<string, string>>({});

  async function salvar() {
    setSalvando(true);
    setErros({});
    const res = await salvarAlertaDeCotacao({
      ceasaProductId,
      unit,
      variacaoMinima: Number(variacao),
      // Campo em branco é "não quero teto", e não zero — que dispararia sempre.
      precoTeto: teto.trim() === "" ? null : Number(teto),
      precoPiso: piso.trim() === "" ? null : Number(piso),
    });
    setSalvando(false);
    if (res.ok) {
      toast.success("Alerta salvo. Ele entra no seu aviso diário.");
      setAberto(false);
      router.refresh();
    } else {
      setErros(res.error.fields ?? {});
      // O texto do campo é mais útil que o genérico quando existe um só.
      const doCampo = Object.values(res.error.fields ?? {});
      toast.error(doCampo.length === 1 ? doCampo[0]! : res.error.message);
    }
  }

  async function remover() {
    setSalvando(true);
    const res = await removerAlertaDeCotacao({ ceasaProductId, unit });
    setSalvando(false);
    if (res.ok) {
      toast.success("Alerta removido.");
      setAberto(false);
      router.refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  if (!aberto) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {atual ? (
            <>
              Avisamos você quando este item variar mais de{" "}
              <strong className="text-foreground">{atual.variacaoMinima}%</strong>
              {atual.precoTeto && <> , passar de R$ {atual.precoTeto}</>}
              {atual.precoPiso && <> ou cair abaixo de R$ {atual.precoPiso}</>}.
            </>
          ) : (
            "Você não recebe aviso deste item."
          )}
        </p>
        <Button size="sm" variant={atual ? "outline" : "default"} onClick={() => setAberto(true)}>
          <Bell className="size-4" />
          {atual ? "Alterar aviso" : "Quero ser avisado"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="variacao">Avisar se variar mais de</Label>
          <div className="flex items-center gap-2">
            <Input
              id="variacao"
              type="number"
              inputMode="decimal"
              min={0.5}
              max={200}
              step={0.5}
              value={variacao}
              onChange={(e) => setVariacao(e.target.value)}
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
          {erros.variacaoMinima && (
            <p className="text-xs text-destructive">{erros.variacaoMinima}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="teto">Avisar se passar de (R$)</Label>
          <Input
            id="teto"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            placeholder="opcional"
            value={teto}
            onChange={(e) => setTeto(e.target.value)}
          />
          {erros.precoTeto && (
            <p className="text-xs text-destructive">{erros.precoTeto}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="piso">Avisar se cair abaixo de (R$)</Label>
          <Input
            id="piso"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            placeholder="opcional"
            value={piso}
            onChange={(e) => setPiso(e.target.value)}
          />
          {erros.precoPiso && (
            <p className="text-xs text-destructive">{erros.precoPiso}</p>
          )}
        </div>
      </div>

      {/*
        A ressalva vai junto do botão, e não num rodapé que ninguém lê: o aviso
        chega com o boletim, que a praça publica em dias próprios. Prometer
        "aviso imediato" para um dado que sai uma vez por dia — e 2 a 3 vezes por
        semana em quatro das sete unidades de Minas — seria vender o que não se
        entrega, e o cliente descobriria sozinho, do pior jeito.
      */}
      <p className="text-xs text-muted-foreground">
        O aviso chega junto com o resumo diário, quando o boletim da sua praça
        trouxer o movimento. Não é aviso instantâneo: o preço do momento é
        negociado no balcão e nenhuma central divulga.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void salvar()} disabled={salvando}>
          {salvando ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />}
          Salvar aviso
        </Button>
        {atual && (
          <Button size="sm" variant="outline" onClick={() => void remover()} disabled={salvando}>
            <BellOff className="size-4" />
            Não avisar mais
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setAberto(false)} disabled={salvando}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
