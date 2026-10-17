import type { Metadata } from "next";
import { CREDITOS_DO_BANCO } from "@/lib/imagem/creditos-banco";

export const metadata: Metadata = {
  title: "Créditos das fotos — CeasaPro",
  description: "Autores e licenças das fotos do banco de fotos de produtos do CeasaPro.",
};

// Sem dados e sem sessão, mas renderizada por requisição para receber o nonce do
// CSP (ver `src/proxy.ts`).
export const dynamic = "force-dynamic";

export default function CreditosFotosPage() {
  return (
    <>
      <h1 className="text-2xl font-bold text-primary">Créditos das fotos</h1>
      <p>
        As fotos do banco de fotos de produtos vêm do{" "}
        <a
          href="https://commons.wikimedia.org"
          className="text-primary underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          Wikimedia Commons
        </a>
        , sob licenças livres. Foram redimensionadas e convertidas para WebP. Cada linha abaixo
        leva à página original da foto, com o autor e o texto completo da licença.
      </p>

      <ul className="flex flex-col divide-y rounded-lg border bg-background">
        {CREDITOS_DO_BANCO.map((c) => (
          <li key={c.produto} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-3">
            <span className="font-semibold sm:w-36 sm:shrink-0">{c.produto}</span>
            <span className="min-w-0 text-muted-foreground">
              {c.autor ?? "Autor indicado na página da foto"} · {c.licenca} ·{" "}
              <a
                href={c.origem}
                className="text-primary underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                ver original
              </a>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
