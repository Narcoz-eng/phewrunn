import type { ReactNode } from "react";
import { V2Sidebar } from "./V2Sidebar";

export function V2AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="v2-shell">
      <V2Sidebar />
      <div className="v2-shell-main">
        <div className="v2-shell-content">
          <div className="v2-shell-stage">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
