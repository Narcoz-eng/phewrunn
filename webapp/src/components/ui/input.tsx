import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-11 w-full rounded-xl border border-border/70 bg-[linear-gradient(180deg,hsl(0_0%_100%/0.96),hsl(38_26%_94%/0.88))] px-3.5 py-2 text-base text-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.82),0_14px_30px_-28px_hsl(var(--foreground)/0.16)] ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:border-primary/40 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:border-white/[0.08] dark:bg-[linear-gradient(180deg,rgba(14,16,22,0.94),rgba(9,11,15,0.98))] dark:shadow-none",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
