import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * "PDF" e "Excel" de um arquivo gerado no servidor — links de download, como
 * os da barra de relatórios (o arquivo sai de uma rota GET, sem JavaScript).
 *
 * `urlBase` é a rota sem o formato; o componente acrescenta `format=`.
 * `no-print`: os botões não saem na impressão da tela.
 */
export function BotoesDeExportacao({
  urlBase,
  rotulo,
  className,
}: {
  urlBase: string;
  /** Nome acessível: diz DE QUÊ é o arquivo ("comprovante da venda de 12/10"). */
  rotulo: string;
  className?: string;
}) {
  const url = (formato: "pdf" | "excel") =>
    `${urlBase}${urlBase.includes("?") ? "&" : "?"}format=${formato}`;
  return (
    <div className={cn("no-print flex shrink-0 gap-2", className)}>
      <Button asChild size="sm" variant="info">
        <a href={url("pdf")} aria-label={`PDF — ${rotulo}`}>
          <FileDown /> PDF
        </a>
      </Button>
      <Button asChild size="sm" variant="info">
        <a href={url("excel")} aria-label={`Excel — ${rotulo}`}>
          <FileDown /> Excel
        </a>
      </Button>
    </div>
  );
}
