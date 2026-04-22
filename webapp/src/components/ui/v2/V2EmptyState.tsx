import type { ReactNode } from "react";
import { V2Surface } from "./V2Surface";

export function V2EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <V2Surface className="flex min-h-[260px] flex-col items-center justify-center gap-4 px-6 py-10 text-center" tone="soft">
      {icon ? (
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-white/70">
          {icon}
        </div>
      ) : null}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <p className="max-w-md text-sm text-white/48">{description}</p>
      </div>
      {action ? <div>{action}</div> : null}
    </V2Surface>
  );
}
