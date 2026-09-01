"use client";

import Link from "next/link";
import { WifiOff } from "lucide-react";
import { useOnline } from "@/lib/pwa/use-online";

/**
 * Faixa permanente enquanto o celular está sem conexão.
 *
 * Existe porque a consequência de estar offline aqui não é óbvia: a navegação
 * continua funcionando (app shell em cache), então sem aviso o usuário tenta
 * lançar uma venda e só descobre o problema quando o botão falha — depois de
 * digitar tudo. A faixa avisa antes, e aponta para onde ele CONSEGUE fazer algo.
 */
export function NetworkStatus() {
  const online = useOnline();
  if (online) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-warning/15 px-4 py-2 text-center text-sm text-warning"
    >
      <WifiOff className="size-4 shrink-0" />
      <span>
        Sem conexão. Você pode{" "}
        <Link href="/consulta-offline" className="font-semibold underline">
          consultar os dados salvos
        </Link>
        , mas não registrar vendas ou pagamentos.
      </span>
    </div>
  );
}
