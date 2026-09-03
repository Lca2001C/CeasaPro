"use client";

import { Compass } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { iniciarTour } from "@/lib/tour/estado";

/**
 * Botão que dispara o tour guiado.
 *
 * O motor (`TourGuiado`) fica no layout do app, e não aqui: começar o tour é só
 * publicar a primeira posição no estado compartilhado. É o que permite este
 * botão estar em qualquer tela — inclusive numa que não é a primeira do
 * roteiro — sem saber nada de driver.js.
 */
export function BotaoTour({
  rotulo = "Fazer o tour guiado",
  ...props
}: { rotulo?: string } & Omit<ButtonProps, "onClick" | "children" | "asChild">) {
  return (
    <Button type="button" onClick={iniciarTour} {...props}>
      <Compass />
      {rotulo}
    </Button>
  );
}
