"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Clock, Loader2, Send, ThumbsDown, ThumbsUp } from "lucide-react";
import { enviarBoletimDaPraca } from "@/actions/cotacoes.actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { formatDateOnly } from "@/lib/format";
import { BOLETIM_ENVIADO_STATUS_LABELS } from "@/lib/labels";
import { isoDateTz } from "@/lib/tz";

/*
  O exemplo usa unidades REAIS de boletim.

  As inventadas ("CX 12UN", "SC 50KG") ensinariam o cliente a digitar um formato
  que a fonte nunca usa — e o dado dele deixaria de casar com o que a importação
  grava para a mesma praça. Medido no boletim de verdade: a maioria esmagadora das
  linhas é KG, e as compostas têm a forma "CX 30 DZ", "DZ 4 KG", "UN 1,5 KG".
*/
const EXEMPLO = `TOMATE SALADA LONGA VIDA;KG;4,00;4,25;4,50
ALFACE CRESPA PRIMEIRA;DZ;25,00;25,00;30,00
OVOS BRANCOS EXTRA;CX 30 DZ;180,00;190,00;200,00`;

interface Enviado {
  id: string;
  quoteDate: Date;
  status: "PENDENTE" | "PUBLICADO" | "RECUSADO";
  linhasValidas: number;
  linhasIgnoradas: number;
  motivo: string | null;
  createdAt: Date;
}

/**
 * A APARÊNCIA de cada estado. O texto vem de `labels.ts`, não daqui.
 *
 * A separação não é cerimônia: `tests/unit/labels-cobertura.test.ts` compara os
 * enums do schema com os mapas de `labels.ts` justamente para que um valor novo
 * não chegue à tela sem tradução — e um mapa de rótulos escondido num componente
 * escapa dessa checagem. Cor e ícone são decisão de tela; palavra é vocabulário
 * do produto.
 */
const SELO = {
  PENDENTE: { variant: "secondary" as const, Icone: Clock },
  PUBLICADO: { variant: "success" as const, Icone: ThumbsUp },
  RECUSADO: { variant: "destructive" as const, Icone: ThumbsDown },
};

export function EnviarBoletimForm({
  central,
  enviados,
}: {
  central: { code: string; name: string; city: string; uf: string };
  enviados: Enviado[];
}) {
  const router = useRouter();
  const [quoteDate, setQuoteDate] = useState(isoDateTz(new Date()));
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});

  async function enviar() {
    setBusy(true);
    setErros({});
    const res = await enviarBoletimDaPraca({ quoteDate, texto });
    setBusy(false);
    if (!res.ok) {
      setErros(res.error.fields ?? {});
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `Boletim enviado: ${res.data.linhasValidas} linhas` +
        (res.data.ignoradas > 0 ? ` · ${res.data.ignoradas} ignoradas` : "") +
        ". Vamos revisar e publicar.",
    );
    setTexto("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <p className="text-sm">
          Você compra em <strong>{central.name}</strong> ({central.city}/{central.uf}), que não
          publica os preços de forma automática. Cole aqui o boletim do dia e nós conferimos e
          publicamos — ele passa a valer para você e para os outros clientes desta praça.
        </p>
        {/*
          Dizer que o preço vale para OS OUTROS TAMBÉM não é detalhe legal: é o
          que faz a pessoa conferir antes de mandar. Esconder isso obteria envios
          mais rápidos e menos cuidadosos.
        */}
      </Card>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="quoteDate">Data do boletim</Label>
        <Input
          id="quoteDate"
          type="date"
          value={quoteDate}
          max={isoDateTz(new Date())}
          onChange={(e) => setQuoteDate(e.target.value)}
        />
        {erros.quoteDate && <p className="text-xs text-destructive">{erros.quoteDate}</p>}
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
        {erros.texto && <p className="text-xs text-destructive">{erros.texto}</p>}
        <span className="text-xs text-muted-foreground">
          Uma linha por produto: <code>produto;unidade;mínimo;comum;máximo</code>. Aceita ponto
          e vírgula ou tabulação — colar direto do Excel funciona — e vírgula ou ponto como
          decimal. Linha com problema é ignorada e o resto entra.
        </span>
      </div>

      <Button type="button" onClick={enviar} disabled={busy || !texto.trim()} className="self-start">
        {busy ? <Loader2 className="animate-spin" /> : <Send className="size-4" />}
        Enviar para revisão
      </Button>

      {enviados.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">O que você já enviou</h2>
          {enviados.map((e) => {
            const selo = SELO[e.status];
            return (
              <Card key={e.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    Boletim de {formatDateOnly(e.quoteDate)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {e.linhasValidas} {e.linhasValidas === 1 ? "linha" : "linhas"}
                    {e.linhasIgnoradas > 0 && ` · ${e.linhasIgnoradas} ignoradas`}
                  </p>
                  {/* O motivo da recusa aparece para quem enviou — senão ele
                      manda o mesmo erro de novo e ninguém entende a fila. */}
                  {e.status === "RECUSADO" && e.motivo && (
                    <p className="mt-1 text-xs text-destructive">{e.motivo}</p>
                  )}
                </div>
                <Badge variant={selo.variant} className="shrink-0 gap-1">
                  <selo.Icone className="size-3" />
                  {BOLETIM_ENVIADO_STATUS_LABELS[e.status]}
                </Badge>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
