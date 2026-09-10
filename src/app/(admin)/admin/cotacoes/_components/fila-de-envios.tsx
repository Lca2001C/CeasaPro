"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import {
  publicarBoletimEnviado,
  recusarBoletimEnviado,
} from "@/actions/admin-cotacoes.actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateOnly } from "@/lib/format";

/** Quantas linhas do texto colado mostrar antes de o operador pedir mais. */
const LINHAS_NA_PREVIA = 8;

interface Envio {
  id: string;
  quoteDate: Date;
  linhasValidas: number;
  linhasIgnoradas: number;
  textoCru: string;
  createdAt: Date;
  central: { code: string; name: string; uf: string };
  tenant: { id: string; tradeName: string };
}

/**
 * A fila de boletins que os clientes enviaram.
 *
 * O trabalho do operador aqui é CONFERIR, não transcrever — e essa é a diferença
 * que faz o recurso escalar. Antes, o boletim de uma praça sem raspador só
 * existia se ele mesmo o obtivesse e colasse, para cada cliente, todo dia.
 *
 * A prévia mostra o texto CRU, e não as linhas já interpretadas: quando o parse
 * discorda do esperado, é o texto original que responde por quê — se o cliente
 * colou a coluna errada, se o separador veio diferente, se o boletim é de outra
 * praça. Ver só o resultado do parse esconderia justamente a informação que faz
 * decidir entre publicar e recusar.
 */
export function FilaDeEnvios({ envios }: { envios: Envio[] }) {
  if (envios.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Boletins enviados por clientes</h2>
        <Badge variant="warning">{envios.length}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Enviados por clientes de praças sem busca automática. Publicar grava o boletim para
        TODOS os clientes daquela praça.
      </p>
      {envios.map((e) => (
        <LinhaDaFila key={e.id} envio={e} />
      ))}
    </div>
  );
}

function LinhaDaFila({ envio }: { envio: Envio }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [tudo, setTudo] = useState(false);

  const linhas = envio.textoCru.split(/\r?\n/).filter((l) => l.trim() !== "");
  const visiveis = tudo ? linhas : linhas.slice(0, LINHAS_NA_PREVIA);

  async function publicar() {
    setBusy(true);
    const res = await publicarBoletimEnviado({ id: envio.id });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `${res.data.cotacoesGravadas} cotações publicadas` +
        (res.data.produtosNovos > 0 ? `, ${res.data.produtosNovos} produtos novos` : ""),
    );
    router.refresh();
  }

  async function recusar() {
    /*
      O motivo é OBRIGATÓRIO, e é pedido antes de qualquer coisa acontecer.

      Recusa sem motivo faz o cliente reenviar o mesmo erro, a fila crescer e
      ninguém entender por quê. O texto vai aparecer na tela dele.
    */
    const motivo = window.prompt(
      `Por que recusar o boletim de ${envio.central.name} do dia ${formatDateOnly(envio.quoteDate)}?\n\nO cliente vai ler este texto.`,
    );
    if (motivo === null) return;
    if (motivo.trim().length < 3) {
      toast.error("Diga o motivo — o cliente vai ler.");
      return;
    }
    setBusy(true);
    const res = await recusarBoletimEnviado({ id: envio.id, motivo });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Envio recusado. O cliente vê o motivo.");
    router.refresh();
  }

  return (
    <Card className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium [overflow-wrap:anywhere]">
            {envio.tenant.tradeName}
          </p>
          <p className="text-xs text-muted-foreground">
            {envio.central.name} ({envio.central.uf}) · boletim de{" "}
            {formatDateOnly(envio.quoteDate)} · {envio.linhasValidas}{" "}
            {envio.linhasValidas === 1 ? "linha válida" : "linhas válidas"}
            {envio.linhasIgnoradas > 0 && ` · ${envio.linhasIgnoradas} ignoradas`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={publicar}>
            {busy ? <Loader2 className="animate-spin" /> : <Check className="size-4" />}
            Publicar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={recusar}
          >
            <X className="size-4" />
            Recusar
          </Button>
        </div>
      </div>

      <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px]">
        {visiveis.join("\n")}
      </pre>
      {linhas.length > LINHAS_NA_PREVIA && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => setTudo((v) => !v)}
        >
          {tudo ? "Mostrar menos" : `Ver as ${linhas.length} linhas`}
        </Button>
      )}
    </Card>
  );
}
