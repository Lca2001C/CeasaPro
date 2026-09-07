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
}

const EXEMPLO = `TOMATE SALADA;CX 20KG;80,00;85,00;92,00
BATATA LISA;SC 50KG;110,00;118,00;125,00
ALFACE CRESPA;CX 12UN;18,00;20,00;24,00`;

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
          <Select
            id="centralCode"
            value={centralCode}
            onChange={(e) => setCentralCode(e.target.value)}
          >
            {centrais.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
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
