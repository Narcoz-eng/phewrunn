import type { ReactNode } from "react";
import { V2Sidebar } from "./V2Sidebar";
import { V2ShellTopbar } from "./V2ShellTopbar";

export function V2AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="v2-shell">
      <V2Sidebar />
      <div className="v2-shell-main">
        <div className="v2-shell-content">
          <div className="v2-shell-stage">
            <V2ShellTopbar />
            <div className="space-y-5">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
