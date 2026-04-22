import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type V2TabBarItem<T extends string> = {
  value: T;
  label: ReactNode;
  badge?: ReactNode;
};

export function V2TabBar<T extends string>({
  value,
  items,
  onChange,
  className,
}: {
  value: T;
  items: Array<V2TabBarItem<T>>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("v2-tabbar", className)}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={cn("v2-tabbar-item", active && "v2-tabbar-item-active")}
          >
            <span>{item.label}</span>
            {item.badge ? <span className="text-[10px] text-white/48">{item.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
