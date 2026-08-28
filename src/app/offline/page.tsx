import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline — CeasaPro" };

// Página de fallback servida pelo service worker quando não há rede.
// Sem dados, mas renderizada por requisição para receber o nonce do CSP (ver
// `src/proxy.ts`). O SW continua pré-cacheando no install: ele guarda a resposta
// inteira, então o HTML e o cabeçalho CSP servidos do cache trazem o MESMO nonce.
export const dynamic = "force-dynamic";

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-secondary/40 p-6 text-center">
      <h1 className="text-2xl font-bold text-primary">CeasaPro</h1>
      <p className="text-lg font-semibold">Você está offline</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        Não foi possível conectar. Verifique sua internet — assim que voltar, é só recarregar
        a página.
      </p>
    </div>
  );
}
