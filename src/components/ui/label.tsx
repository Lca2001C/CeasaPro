import * as React from "react";
import { cn } from "@/lib/cn";

const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    /*
      `label-has-associated-control` não segue a composição: o `htmlFor` chega
      por `{...props}`, e a regra só olha este JSX. Falso positivo de primitivo.
      Desligado nesta linha apenas — um `<label>` solto em qualquer tela
      continua sendo apanhado.

      Que os chamadores realmente passem o `htmlFor` não fica por conta da
      regra: quem cobra isso é o teste de acessibilidade em
      `tests/e2e/acessibilidade.spec.ts`, que roda o axe na tela montada e
      enxerga o par rótulo/campo como o navegador o vê.
    */
    // eslint-disable-next-line jsx-a11y/label-has-associated-control
    <label
      ref={ref}
      className={cn(
        "text-sm font-medium leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      )}
      {...props}
    />
  ),
);
Label.displayName = "Label";

export { Label };
