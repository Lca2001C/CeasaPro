import type { Metadata } from "next";
import { ConsultaOfflineClient } from "./_components/consulta-client";

export const metadata: Metadata = {
  title: "Consulta offline — CeasaPro",
  robots: { index: false, follow: false },
};

// Renderizada por requisição para receber o nonce do CSP (ver `src/proxy.ts`).
// O service worker guarda a RESPOSTA inteira no precache, então o HTML e o
// cabeçalho CSP servidos offline trazem o mesmo nonce — igual à /offline.
export const dynamic = "force-dynamic";

/**
 * Tela de consulta sem rede.
 *
 * Fica FORA do grupo `(app)` de propósito: aquele layout exige sessão válida e
 * consulta o banco, e nenhuma das duas coisas existe offline. Aqui o servidor só
 * entrega o casco — todo o conteúdo vem do IndexedDB, no cliente.
 *
 * Também é pública no proxy pelo mesmo motivo: sem rede o token pode ter expirado,
 * e redirecionar para /login deixaria o usuário sem acesso justamente aos dados que
 * ele já tem no aparelho. O que protege esses dados é o `limparSnapshotNoLogout`.
 */
export default function ConsultaOfflinePage() {
  return <ConsultaOfflineClient />;
}
