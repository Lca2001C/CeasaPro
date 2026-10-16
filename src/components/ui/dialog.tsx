"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Modal do app — **folha de baixo no celular, diálogo no desktop**.
 *
 * No celular o modal sobe da borda de baixo (cantos de cima arredondados,
 * alça de arraste visual), porque é onde o polegar alcança e o teclado não
 * empurra o botão principal para fora da tela. A partir de 640px vira o
 * diálogo centralizado de sempre, com raio grande.
 *
 * O que o Radix já garante e não pode ser perdido em customização:
 * fechar com Esc e com clique fora, foco preso dentro do modal e devolvido ao
 * elemento que o abriu. O botão de fechar tem nome acessível ("Fechar") e
 * alvo de 44px.
 *
 * Quem chama ainda pode sobrescrever posição e padding por `className` (o
 * `cn` resolve o conflito a favor de quem chama) — é o que o modal de produto
 * faz para ocupar a tela inteira no celular.
 */

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogOverlay({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn("anim-sobreposicao fixed inset-0 z-50 bg-black/50", className)}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          // Celular: folha de baixo.
          "anim-modal fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col gap-4 overflow-y-auto rounded-t-xl border border-b-0 border-border/60 bg-elevada p-6 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-foreground shadow-elevada outline-none",
          // Com rodapé direto na folha, o recuo de baixo passa a ser DELE: um
          // elemento sticky não sai da área de conteúdo do pai, então o recuo
          // aqui empurraria o rodapé para cima, por cima do texto.
          "max-sm:has-[>[data-slot=dialog-footer]]:pb-0",
          // Desktop: diálogo centralizado.
          "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[90dvh] sm:w-[calc(100%-2rem)] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border-b",
          className,
        )}
        {...props}
      >
        <AlcaDaFolha />
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 flex size-11 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <X className="size-5" />
          <span className="sr-only">Fechar</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** A alça visual da folha de baixo — só no celular, só decoração. */
function AlcaDaFolha() {
  return (
    <div
      aria-hidden
      className="mx-auto -mt-1 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/30 sm:hidden"
    />
  );
}

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 pr-10 text-left", className)} {...props} />;
}

/**
 * Rodapé de ações. No celular os botões ocupam a largura toda e o rodapé
 * gruda embaixo da folha enquanto o conteúdo rola — o botão principal fica
 * sempre ao alcance, mesmo num formulário comprido. O recuo do fim da folha
 * (barra de gestos incluída) fica no próprio rodapé.
 */
function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 [&>*]:w-full max-sm:sticky max-sm:bottom-0 max-sm:-mx-6 max-sm:bg-elevada max-sm:px-6 max-sm:pt-2 max-sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:[&>*]:w-auto",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({
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

function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
