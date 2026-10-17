"use client";

import { Toaster } from "@/components/ui/sonner";
import { SincronizadorDeTema } from "@/components/tema/controles-de-tema";

/*
  Sem React Query: o `QueryClientProvider` envolvia o app inteiro e nenhuma tela
  usava `useQuery`/`useMutation` — eram ~13 KB gzip em toda página por nada. Os
  dados vêm de Server Components e Server Actions.
*/
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SincronizadorDeTema />
      {children}
      <Toaster />
    </>
  );
}
