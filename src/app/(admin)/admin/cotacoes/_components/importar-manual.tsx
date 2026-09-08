"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { importarBoletimManual } from "@/actions/admin-cotacoes.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { isoDateTz } from "@/lib/tz";

interface Central {
  code: string;
  name: string;
  uf: string;
}

/*
  Exemplo com unidades REAIS de boletim.

  Antes dizia "CX 20KG", "SC 50KG", "CX 12UN" — nenhuma delas existe. Medindo o
  boletim de verdade (215 linhas): 173 são KG, 14 são DZ, e o resto são compostas
  como "CX 30 DZ", "DZ 4 KG" e "UN 1,5 KG". Um placeholder inventado ensina o
  operador a digitar um formato que a fonte nunca usa, e o dado colado deixa de
  casar com o que a importação automática grava para a mesma praça.
*/
const EXEMPLO = `TOMATE SALADA LONGA VIDA;KG;4,00;4,25;4,50
ALFACE CRESPA PRIMEIRA;DZ;25,00;25,00;30,00
OVOS BRANCOS EXTRA;CX 30 DZ;180,00;190,00;200,00`;

/**
 * Importação manual de boletim.
 *
 * Texto colado, não upload: o projeto não tem handler de multipart em lugar
 * nenhum, e um `<textarea>` atravessa o caminho que já existe sem inventar
 * infraestrutura. O efeito para quem usa é o mesmo — copiar do site da central
 * ou da planilha e colar aqui.
 */
export function ImportarManual({ centrais }: { centrais: Central[] }) {
  const router = useRouter();
  const [centralCode, setCentralCode] = useState(centrais[0]?.code ?? "");
  const [quoteDate, setQuoteDate] = useState(isoDateTz(new Date()));
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);

  const porUf = Object.entries(
    centrais.reduce<Record<string, Central[]>>((acc, c) => {
      (acc[c.uf] ??= []).push(c);
      return acc;
    }, {}),
  ).sort(([a], [b]) => a.localeCompare(b));

  async function enviar() {
    setBusy(true);
    const res = await importarBoletimManual({ centralCode, quoteDate, texto });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    const d = res.data;
    toast.success(
      `${d.cotacoesGravadas} cotações gravadas` +
        (d.produtosNovos > 0 ? `, ${d.produtosNovos} produtos novos` : "") +
        (d.ignoradas > 0 ? ` · ${d.ignoradas} linhas ignoradas` : ""),
    );
    setTexto("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="centralCode">Central</Label>
          {/*
            Agrupado por UF: o catálogo tem 65 centrais, e uma lista corrida
            obriga a procurar de olho item por item para achar a praça certa —
            justamente quando alguém está apagando incêndio porque a busca
            automática caiu.
          */}
          <Select
            id="centralCode"
            value={centralCode}
            onChange={(e) => setCentralCode(e.target.value)}
          >
            {porUf.map(([uf, doEstado]) => (
              <optgroup key={uf} label={uf}>
                {doEstado.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quoteDate">Data do boletim</Label>
          <Input
            id="quoteDate"
            type="date"
            value={quoteDate}
            onChange={(e) => setQuoteDate(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="texto">Boletim</Label>
        <textarea
          id="texto"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={12}
          spellCheck={false}
          placeholder={EXEMPLO}
          className="w-full rounded-md border bg-background p-3 font-mono text-xs"
        />
        <span className="text-xs text-muted-foreground">
          Uma linha por cotação:{" "}
          <code>produto;unidade;mínimo;comum;máximo</code>. Aceita ponto e vírgula ou
          tabulação (colar do Excel funciona), e vírgula ou ponto como decimal. Linha com
          problema é ignorada, o resto entra. Reimportar a mesma data corrige o que já
          estava lá em vez de duplicar.
        </span>
      </div>

      <Button type="button" onClick={enviar} disabled={busy || !texto.trim() || !centralCode}>
        {busy && <Loader2 className="animate-spin" />}
        Importar boletim
      </Button>
    </div>
  );
}
