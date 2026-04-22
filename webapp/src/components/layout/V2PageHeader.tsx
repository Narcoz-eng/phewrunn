import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function V2PageHeader({
  title,
  description,
  badge,
  action,
  onBack,
  className,
}: {
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  onBack?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("v2-page-header", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="mt-0.5 h-11 w-11 shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] text-white/74 hover:bg-white/[0.08] hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        ) : null}
        <div className="min-w-0 space-y-2">
          {badge ? <div>{badge}</div> : null}
          <div className="text-3xl font-semibold tracking-tight text-white">{title}</div>
          {description ? <div className="max-w-3xl text-sm text-white/50">{description}</div> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
