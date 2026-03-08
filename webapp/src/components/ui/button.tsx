import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold ring-offset-background transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:saturate-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-primary/15 bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(158_51%_42%))] text-primary-foreground shadow-[0_18px_42px_-18px_hsl(var(--primary)/0.58)] hover:brightness-[1.04] hover:shadow-[0_24px_52px_-20px_hsl(var(--primary)/0.62)] dark:border-white/10 dark:shadow-[0_18px_48px_-24px_rgba(0,0,0,0.92)]",
        destructive:
          "border border-destructive/20 bg-[linear-gradient(135deg,hsl(var(--destructive)),hsl(4_78%_50%))] text-destructive-foreground shadow-[0_18px_42px_-18px_hsl(var(--destructive)/0.45)] hover:brightness-[1.03]",
        outline:
          "border border-border/70 bg-[linear-gradient(180deg,hsl(0_0%_100%/0.86),hsl(38_34%_94%/0.82))] text-foreground shadow-[0_18px_36px_-30px_hsl(var(--foreground)/0.18)] hover:border-primary/30 hover:bg-[linear-gradient(180deg,hsl(0_0%_100%/0.96),hsl(39_36%_95%/0.9))] dark:border-white/[0.09] dark:bg-[linear-gradient(180deg,rgba(16,18,24,0.94),rgba(10,12,17,0.98))] dark:shadow-none",
        secondary:
          "border border-border/60 bg-[linear-gradient(180deg,hsl(0_0%_100%/0.68),hsl(36_30%_92%/0.8))] text-secondary-foreground shadow-[0_16px_32px_-28px_hsl(var(--foreground)/0.16)] hover:border-border hover:bg-[linear-gradient(180deg,hsl(0_0%_100%/0.9),hsl(37_35%_94%/0.84))] dark:border-white/[0.08] dark:bg-[linear-gradient(180deg,rgba(17,19,26,0.9),rgba(10,12,16,0.94))] dark:shadow-none",
        ghost:
          "border border-transparent text-muted-foreground hover:border-border/60 hover:bg-white/65 hover:text-foreground dark:hover:border-white/[0.08] dark:hover:bg-white/[0.05] dark:hover:text-white",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-4 py-2",
        sm: "h-9 rounded-lg px-3",
        lg: "h-12 rounded-2xl px-8",
        icon: "h-10 w-10 rounded-2xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
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
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
