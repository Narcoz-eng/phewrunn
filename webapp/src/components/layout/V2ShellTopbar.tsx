import { useMemo, useState } from "react";
import { Bell, Mail, Search } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-client";
import { getAvatarUrl } from "@/types";

const MARKET_STRIP = [
  { symbol: "Market Cap", value: "$2.45T", delta: "+2.34%" },
  { symbol: "24H Volume", value: "$146.1B", delta: "+8.21%" },
  { symbol: "BTC Dominance", value: "52.3%", delta: "-0.32%" },
] as const;

export function V2ShellTopbar() {
  const { user } = useAuth();
  const [query, setQuery] = useState("");

  const marketStrip = useMemo(
    () =>
      MARKET_STRIP.map((item) => (
        <div
          key={item.symbol}
          className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5"
        >
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">
            <span className="text-white/72">{item.symbol}</span>
            <span className="text-white/54">{item.value}</span>
            <span className="text-[#76ff44]">{item.delta}</span>
          </div>
        </div>
      )),
    []
  );

  return (
    <div className="v2-shell-topbar">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap gap-2">{marketStrip}</div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="v2-shell-search">
            <Search className="h-4 w-4 text-white/34" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tokens, users, raids..."
              className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/28"
              aria-label="Search tokens, users, raids"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-11 rounded-2xl border border-white/10 bg-white/[0.04] text-white/62 hover:bg-white/[0.08] hover:text-white"
            >
              <Bell className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-11 rounded-2xl border border-white/10 bg-white/[0.04] text-white/62 hover:bg-white/[0.08] hover:text-white"
            >
              <Mail className="h-4 w-4" />
            </Button>

            <div className="flex items-center gap-3 rounded-[24px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] px-3 py-2">
              <Avatar className="h-10 w-10 border border-white/10">
                <AvatarImage src={user ? getAvatarUrl(user.id, user.image) : undefined} />
                <AvatarFallback className="bg-white/[0.06] text-white/68">
                  {(user?.name ?? user?.username ?? "P").charAt(0)}
                </AvatarFallback>
              </Avatar>
              <div className="hidden min-w-0 sm:block">
                <div className="truncate text-sm font-semibold text-white">
                  {user?.username || user?.name || "Phew User"}
                </div>
                <div className="text-[11px] uppercase tracking-[0.14em] text-white/36">
                  Crypto-native control surface
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
