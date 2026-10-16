import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Select nativo estilizado — no mobile abre o seletor do próprio sistema
 * operacional (melhor UX de toque que um dropdown custom).
 */
const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => {
  return (
    <div className="relative w-full min-w-0">
      <select
        ref={ref}
        className={cn(
          "flex h-12 appearance-none w-full rounded-md border border-input bg-superficie px-4 py-2 pr-10 text-base text-foreground placeholder:text-muted-foreground outline-none motion-safe:transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
});
Select.displayName = "Select";

export { Select };
