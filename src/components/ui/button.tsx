import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Botão em pílula.
 *
 * - **Alvo de toque ≥ 44px** em todos os tamanhos, inclusive o `sm` (era 36px):
 *   no balcão, com a mão ocupada, o toque que erra o botão vira venda errada.
 * - **Foco sempre visível**: anel de 2px com folga da cor da página, para não
 *   sumir sobre o próprio botão colorido.
 * - **Movimento só para quem quer**: transição de cor e o "afundar" do toque
 *   ficam atrás de `motion-safe:`.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 motion-safe:transition-[color,background-color,box-shadow,transform] motion-safe:duration-150 motion-safe:active:scale-[0.98] [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-suave hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-suave hover:bg-destructive/90",
        info: "bg-info text-info-foreground shadow-suave hover:bg-info/90",
        violet: "bg-violet text-violet-foreground shadow-suave hover:bg-violet/90",
        // Ações com texto e cor que já dizem o que fazem: verde confirma
        // (pagar, vender, salvar), âmbar pede atenção (resetar, desativar).
        success: "bg-success text-success-foreground shadow-suave hover:bg-success/90",
        warning: "bg-warning text-warning-foreground shadow-suave hover:bg-warning/90",
        outline:
          "border border-input bg-superficie text-foreground hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
        link: "rounded-md text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-12 px-6",
        sm: "h-11 px-4",
        lg: "h-14 px-7 text-base",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
