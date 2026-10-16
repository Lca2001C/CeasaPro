"use client";

import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="top-center"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: "rounded-lg border border-border/60 bg-elevada text-foreground shadow-elevada",
        },
      }}
    />
  );
}
