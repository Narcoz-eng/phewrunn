import {
  Activity,
  Bot,
  Bell,
  Boxes,
  CandlestickChart,
  Crosshair,
  Flame,
  LogOut,
  MessageSquare,
  Radar,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserRound,
  Users,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { BrandLogo } from "@/components/BrandLogo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { getAvatarUrl } from "@/types";

type SidebarNavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  match: (pathname: string, search: string) => boolean;
};

const navItems: SidebarNavItem[] = [
  { to: "/", label: "Feed", icon: Activity, match: (pathname: string) => pathname === "/" },
  {
    to: "/terminal?mode=raids",
    label: "X Raids",
    icon: Crosshair,
    match: (pathname: string, search: string) =>
      pathname.startsWith("/terminal") && search.includes("mode=raids"),
  },
  {
    to: "/terminal",
    label: "Terminal",
    icon: CandlestickChart,
    match: (pathname: string, search: string) =>
      pathname.startsWith("/terminal") && !search.includes("mode=raids"),
  },
  {
    to: "/token/So11111111111111111111111111111111111111112",
    label: "Portfolio",
    icon: WalletCards,
    match: (pathname: string) => pathname.startsWith("/token/"),
  },
  {
    to: "/bundle-checker",
    label: "Wallet Tracker",
    icon: Boxes,
    match: (pathname: string) => pathname.startsWith("/bundle-checker"),
  },
  {
    to: "/leaderboard",
    label: "Leaderboard",
    icon: Trophy,
    match: (pathname: string) => pathname.startsWith("/leaderboard"),
  },
  {
    to: "/communities/So11111111111111111111111111111111111111112",
    label: "Communities",
    icon: Users,
    match: (pathname: string) => pathname.startsWith("/communities"),
  },
  {
    to: "/leaderboard",
    label: "AI Intelligence",
    icon: Bot,
    match: () => false,
  },
  {
    to: "/notifications",
    label: "Notifications",
    icon: Bell,
    match: (pathname: string) => pathname.startsWith("/notifications"),
  },
  { to: "/profile", label: "Messages", icon: MessageSquare, match: () => false },
  { to: "/profile", label: "Watchlist", icon: ScrollText, match: () => false },
  {
    to: "/profile",
    label: "Profile",
    icon: UserRound,
    match: (pathname: string) => pathname.startsWith("/profile"),
  },
];

const mobileNavItems = [
  navItems[0],
  navItems[1],
  navItems[2],
  navItems[5],
  navItems[10],
].filter(Boolean);

function SidebarNavItems({ mobile = false }: { mobile?: boolean }) {
  const location = useLocation();
  const items = mobile ? mobileNavItems : navItems;

  return (
    <>
      {items.map((item) => {
        const active = item.match(location.pathname, location.search);
        return (
          <NavLink
            key={`${item.label}:${item.to}`}
            to={item.to}
            className={cn(
              mobile ? "v2-mobile-nav-item" : "v2-sidebar-link",
              active && (mobile ? "v2-mobile-nav-item-active" : "v2-sidebar-link-active")
            )}
          >
            <item.icon className="h-4.5 w-4.5 shrink-0" />
            <span className={mobile ? "sr-only" : ""}>{item.label}</span>
          </NavLink>
        );
      })}
    </>
  );
}

export function V2Sidebar() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const xpProgress = Math.max(6, ((user?.xp ?? 0) % 1000) / 10);

  return (
    <>
      <aside className="v2-sidebar hidden lg:flex">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <BrandLogo size="md" className="gap-3" />
            <div className="rounded-full border border-emerald-400/18 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
              Live
            </div>
          </div>

          <div className="rounded-[24px] border border-white/[0.08] bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.1),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/36">
              Operator Mode
            </div>
            <div className="mt-3 grid gap-3">
              <div className="flex items-center justify-between gap-3 rounded-[18px] border border-white/[0.07] bg-black/20 px-3 py-3">
                <div className="flex items-center gap-2 text-sm text-white/68">
                  <Sparkles className="h-4 w-4 text-[#76ff44]" />
                  AI signal mesh
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#76ff44]">
                  Active
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-[18px] border border-white/[0.07] bg-black/20 px-3 py-3">
                <div className="flex items-center gap-2 text-sm text-white/68">
                  <Flame className="h-4 w-4 text-cyan-300" />
                  Raid pressure
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/48">
                  Monitoring
                </span>
              </div>
            </div>
          </div>
        </div>

        <nav className="mt-8 flex flex-1 flex-col gap-2">
          <SidebarNavItems />
        </nav>

        <div className="v2-sidebar-user">
          <div className="flex items-center gap-3">
            <Avatar className="h-11 w-11 border border-white/10">
              <AvatarImage src={user ? getAvatarUrl(user.id, user.image) : undefined} />
              <AvatarFallback className="bg-white/[0.06] text-white/70">
                {(user?.name ?? "P").charAt(0)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-white">
                {user?.username || user?.name || "Phew User"}
              </div>
              <div className="text-xs text-white/42">Level {user?.level ?? 0}</div>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#a9ff34,#41e8cf)]"
              style={{ width: `${xpProgress}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-white/42">
            <span>{(user?.xp ?? 0).toLocaleString()} XP</span>
            <span>Realtime enabled</span>
          </div>
          <div className="mt-4 rounded-[22px] border border-white/[0.08] bg-black/20 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/34">
              Quick actions
            </div>
            <div className="mt-3 grid gap-2">
              {[
                { label: "Open terminal", icon: CandlestickChart, onClick: () => navigate("/terminal") },
                { label: "Launch raid", icon: Flame, onClick: () => navigate("/terminal?mode=raids") },
                { label: "Leader arena", icon: Trophy, onClick: () => navigate("/leaderboard") },
                {
                  label: "Community room",
                  icon: Users,
                  onClick: () => navigate("/communities/So11111111111111111111111111111111111111112"),
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={item.onClick}
                    className="flex items-center justify-between rounded-[16px] border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-left text-sm text-white/66 transition hover:border-[#76ff44]/20 hover:bg-white/[0.06] hover:text-white"
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-[#76ff44]" />
                      {item.label}
                    </span>
                    <ShieldCheck className="h-3.5 w-3.5 text-white/28" />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] text-white/72 hover:bg-white/[0.08] hover:text-white"
              onClick={() => navigate("/profile")}
            >
              <Radar className="mr-2 h-4 w-4" />
              Account
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="rounded-xl border border-white/10 bg-white/[0.04] text-white/72 hover:bg-white/[0.08] hover:text-white"
              onClick={signOut}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      <div className="v2-mobile-nav lg:hidden">
        <SidebarNavItems mobile />
      </div>
    </>
  );
}
