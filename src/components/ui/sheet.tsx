"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Folha presa a uma borda da tela (menu "Mais", convite de instalação).
 *
 * Para modal de formulário use `Dialog`: ele já vira folha de baixo no
 * celular e diálogo no desktop. Esta aqui é a folha que fica na borda em
 * QUALQUER tamanho de tela.
 */
const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;

function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  side?: "right" | "left" | "bottom";
}) {
  const sideClasses = {
    right: "anim-folha-direita inset-y-0 right-0 h-full w-4/5 max-w-sm rounded-l-xl border-l",
    left: "anim-folha-esquerda inset-y-0 left-0 h-full w-4/5 max-w-sm rounded-r-xl border-r",
    // A folha de baixo encosta na borda física da tela (`viewport-fit=cover`), e
    // é nela que ficam os botões de ação — o convite de instalação e o menu
    // "Mais" são folhas. O recuo mantém o respiro de 1.25rem do `p-5` e SOMA o
    // recorte de baixo, senão o último botão fica sob a barra de gestos.
    bottom:
      "anim-folha-baixo inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl border-t pt-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]",
  } as const;

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="anim-sobreposicao fixed inset-0 z-50 bg-black/50" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col gap-4 overflow-y-auto border-border/60 bg-elevada p-5 text-foreground shadow-elevada outline-none",
          sideClasses[side],
          className,
        )}
        {...props}
      >
        {side === "bottom" && (
          <div
            aria-hidden
            className="mx-auto -mt-1 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/30"
          />
        )}
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 flex size-11 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <X className="size-5" />
          <span className="sr-only">Fechar</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 pr-10", className)} {...props} />;
}

function SheetTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-xl font-bold leading-tight tracking-tight", className)}
      {...props}
    />
  );
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetTitle };
