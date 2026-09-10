import { AlertTriangle } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/session";
import { CotacoesImportService } from "@/lib/services/cotacoes-import.service";
import { CotacoesEnvioService } from "@/lib/services/cotacoes-envio.service";
import { frescorDoBoletim, rotuloDeFrescor } from "@/lib/cotacoes/frescor";
import { CEASA_IMPORT_STATUS_LABELS } from "@/lib/labels";
import { formatDateOnly, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/data/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { SecaoRecolhivel } from "@/components/data/secao-recolhivel";
import { ImportarManual } from "./_components/importar-manual";
import { FilaDeEnvios } from "./_components/fila-de-envios";

export const dynamic = "force-dynamic";

/**
 * Saúde da importação de cotações.
 *
 * Esta tela existe porque raspagem quebra, e o desfecho normal de uma raspagem
 * quebrada é o módulo morrer sem ninguém perceber. Aqui a quebra fica visível
 * para quem pode consertar — e ao lado dela fica o caminho manual, para o
 * módulo continuar de pé enquanto o conserto não sai.
 */
export default async function AdminCotacoesPage() {
  await requireSuperAdmin();
  const [centrais, fila] = await Promise.all([
    CotacoesImportService.situacaoDasCentrais(),
    CotacoesEnvioService.listarFila(),
  ]);
  const agora = new Date();

  /*
    O catálogo passou de 7 para 65 centrais, e listar as 65 como cartões iguais
    enterra o que importa: uma central com CLIENTE e sem boletim é problema; uma
    central que ninguém escolheu e nunca teve boletim é o estado esperado de 57
    delas.

    Então a tela separa por quem precisa de atenção. As sem cliente ficam atrás
    de um toque — continuam acessíveis (é de lá que se importa boletim manual
    para uma praça nova), mas não competem com o alarme.
  */
  const comCliente = centrais.filter((c) => c.clientes > 0);
  const semCliente = centrais.filter((c) => c.clientes === 0);

  /*
    "Precisa de atenção" só vale para central com FONTE AUTOMÁTICA.

    Central manual nunca terá boletim recente por conta própria — pintá-la de
    amarelo é ruído permanente, não alerta. Pior: `verificarDefasagem` já
    exclui as manuais do aviso, então a tela dizia "atenção" para algo que o
    alarme foi ensinado a ignorar. Tela e alarme discordando é a forma mais
    rápida de os dois deixarem de ser lidos.

    A manual com cliente não é ignorada: ela ganha um estado PRÓPRIO
    ("depende de envio manual"), que é informação e não alarme falso.
  */
  const precisaAtencao = (c: (typeof centrais)[number]) =>
    c.sourceKey !== "manual" &&
    frescorDoBoletim(c.ultimoBoletim, agora, c.maxDiasSemBoletim).nivel !== "atual";
  const problemas = comCliente.filter(precisaAtencao);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Cotações do CEASA"
        description="Estado da importação por central e entrada manual de boletim."
      />

      <Card className="p-3 text-sm">
        <p>
          <strong>{centrais.length}</strong> centrais no catálogo ·{" "}
          <strong>{centrais.filter((c) => c.sourceKey !== "manual").length}</strong> com busca
          automática · <strong>{comCliente.length}</strong> com cliente
          {problemas.length > 0 && (
            <>
              {" · "}
              <span className="font-medium text-warning">
                {problemas.length} precisando de atenção
              </span>
            </>
          )}
          {fila.length > 0 && (
            <>
              {" · "}
              <span className="font-medium text-warning">
                {fila.length} {fila.length === 1 ? "envio de cliente" : "envios de clientes"} na
                fila
              </span>
            </>
          )}
        </p>
      </Card>

      {/*
        A fila vem ANTES da lista de centrais.

        É trabalho que alguém já fez e está esperando um clique — e um envio
        parado é pior que não ter o recurso: o cliente cumpriu a parte dele e o
        preço continua não aparecendo na tela dele. A lista de praças é
        diagnóstico; a fila é ação.
      */}
      <FilaDeEnvios envios={fila} />

      <div className="flex flex-col gap-2">
        {comCliente.map((c) => {
          const frescor = frescorDoBoletim(c.ultimoBoletim, agora, c.maxDiasSemBoletim);
          const rotulo = rotuloDeFrescor(frescor);
          const preocupante = precisaAtencao(c);
          const dependeDeEnvio = c.sourceKey === "manual";
          return (
            <Card
              key={c.code}
              className={cn("p-3", preocupante && "border-warning/50 bg-warning/5")}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {c.name}{" "}
                    <span className="font-normal text-muted-foreground">
                      ({c.code} · {c.sourceKey})
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.clientes === 0
                      ? "Nenhuma empresa usa esta central"
                      : `${c.clientes} ${c.clientes === 1 ? "empresa usa" : "empresas usam"}`}
                    {" · "}
                    {c.ultimoBoletim
                      ? `último boletim ${formatDateOnly(c.ultimoBoletim)}`
                      : "nenhum boletim recebido"}
                  </p>
                  {c.ultimaExecucao && (
                    <p className="text-xs text-muted-foreground">
                      Última tentativa: {CEASA_IMPORT_STATUS_LABELS[c.ultimaExecucao.status]} ·{" "}
                      {c.ultimaExecucao.rowsUpserted} linhas ·{" "}
                      {formatDateTime(c.ultimaExecucao.startedAt)}
                      {c.ultimaExecucao.error && ` · ${c.ultimaExecucao.error}`}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {!c.active && <Badge variant="secondary">Desativada</Badge>}
                  {/*
                    Estado próprio para a manual: é informação ("cabe a nós
                    enviar"), não alarme de quebra. Assim a tela concorda com o
                    alarme, que já a ignora.
                  */}
                  {dependeDeEnvio && (
                    <Badge variant="secondary">Depende de envio manual</Badge>
                  )}
                  {preocupante && rotulo && (
                    <Badge variant="warning" className="gap-1">
                      <AlertTriangle className="size-3" />
                      {rotulo}
                    </Badge>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
        {comCliente.length === 0 && (
          <Card className="p-3">
            <p className="text-sm text-muted-foreground">
              Nenhuma empresa escolheu central ainda.
            </p>
          </Card>
        )}
      </div>

      <SecaoRecolhivel
        titulo={`Centrais sem cliente (${semCliente.length})`}
        descricao="Não são importadas nem alarmam. Ficam aqui para consulta e para receber boletim manual."
      >
        <div className="flex flex-col gap-1 text-sm">
          {semCliente.map((c) => (
            <div key={c.code} className="flex flex-wrap justify-between gap-2 py-0.5">
              <span className="truncate">
                {c.name} <span className="text-muted-foreground">({c.uf})</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {c.sourceKey === "manual" ? "manual" : "automática"}
                {c.ultimoBoletim ? ` · ${formatDateOnly(c.ultimoBoletim)}` : " · sem boletim"}
              </span>
            </div>
          ))}
        </div>
      </SecaoRecolhivel>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Importar boletim manualmente</CardTitle>
        </CardHeader>
        <CardContent>
          <ImportarManual centrais={centrais.filter((c) => c.active)} />
        </CardContent>
      </Card>
    </div>
  );
}
