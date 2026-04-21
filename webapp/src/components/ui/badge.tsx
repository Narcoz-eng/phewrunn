/* eslint-disable react-refresh/only-export-components */
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.04em] transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-primary/15 bg-primary text-primary-foreground shadow-[0_12px_24px_-16px_hsl(var(--primary)/0.45)] hover:brightness-[1.02]",
        secondary: "border-border/70 bg-[linear-gradient(180deg,hsl(0_0%_100%/0.82),hsl(38_28%_92%/0.88))] text-secondary-foreground dark:border-white/[0.08] dark:bg-white/[0.05]",
        destructive: "border-destructive/20 bg-destructive text-destructive-foreground hover:brightness-[1.02]",
        outline: "border-border/70 bg-transparent text-foreground dark:border-white/[0.08]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> { }

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
