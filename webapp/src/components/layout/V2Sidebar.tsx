import {
  Activity,
  Bell,
  Boxes,
  CandlestickChart,
  Crosshair,
  Flame,
  Globe2,
  LogOut,
  Settings,
  ShieldCheck,
  Trophy,
  UserRound,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { BrandLogo } from "@/components/BrandLogo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { getAvatarUrl } from "@/types";

type NavItem = {
  to?: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  badge?: string;
  match?: (pathname: string, search: string) => boolean;
};

const navItems: NavItem[] = [
  { to: "/", label: "Feed", icon: Activity, match: (pathname) => pathname === "/" },
  {
    to: "/raids",
    label: "X Raids",
    icon: Crosshair,
    match: (pathname) => pathname.startsWith("/raids"),
  },
  {
    to: "/terminal",
    label: "Terminal",
    icon: CandlestickChart,
    match: (pathname, search) =>
      (pathname.startsWith("/terminal") && !search.includes("mode=raids")) || pathname.startsWith("/token/"),
  },
  { to: "/bundle-checker", label: "Bundle Checker", icon: Boxes, match: (pathname) => pathname.startsWith("/bundle-checker") },
  { to: "/leaderboard", label: "Leaderboard", icon: Trophy, match: (pathname) => pathname.startsWith("/leaderboard") },
  { to: "/communities", label: "Communities", icon: Users, match: (pathname) => pathname.startsWith("/communities") },
  { to: "/notifications", label: "Notifications", icon: Bell, match: (pathname) => pathname.startsWith("/notifications") },
  { to: "/profile", label: "Profile", icon: UserRound, match: (pathname) => pathname.startsWith("/profile") },
];

const mobileNavItems = [navItems[0], navItems[1], navItems[2], navItems[4], navItems[7]].filter(Boolean);

function SidebarNavItems({ mobile = false }: { mobile?: boolean }) {
  const location = useLocation();
  const items = mobile ? mobileNavItems : navItems;

  return (
    <>
      {items.map((item) => {
        const Icon = item.icon;
        const active = Boolean(item.to && item.match?.(location.pathname, location.search));
        const className = cn(
          mobile ? "v2-mobile-nav-item" : "v2-sidebar-link",
          active && (mobile ? "v2-mobile-nav-item-active" : "v2-sidebar-link-active"),
          item.disabled && "cursor-not-allowed opacity-45"
        );

        const body = (
          <>
            <Icon className="h-[18px] w-[18px] shrink-0" />
            <span className={cn("min-w-0 flex-1 truncate", mobile && "sr-only")}>{item.label}</span>
            {item.badge && !mobile ? (
              <span className="rounded-full bg-[#a9ff34] px-1.5 py-0.5 text-[10px] font-extrabold leading-none text-[#081108]">
                {item.badge}
              </span>
            ) : null}
          </>
        );

        if (!item.to || item.disabled) {
          return (
            <div key={item.label} className={className} aria-disabled="true" title="Unavailable">
              {body}
            </div>
          );
        }

        return (
          <NavLink key={item.to} to={item.to} className={className}>
            {body}
          </NavLink>
        );
      })}
    </>
  );
}

export function V2Sidebar() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const xp = user?.xp ?? 0;
  const level = user?.level ?? 0;
  const nextLevelXp = Math.max(25_000, Math.ceil((xp + 1) / 25_000) * 25_000);
  const xpProgress = Math.max(4, Math.min(100, (xp / nextLevelXp) * 100));
  const aiScore = null;

  return (
    <>
      <aside className="v2-sidebar hidden lg:flex">
        <div className="v2-sidebar-scroll">
        <div className="px-1">
          <BrandLogo size="md" className="gap-3" />
        </div>

        <nav className="mt-7 flex flex-col gap-1.5">
          <SidebarNavItems />
        </nav>

        <div className="mt-7 space-y-4 border-t border-white/[0.07] pt-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12 border border-lime-300/20">
              <AvatarImage src={user ? getAvatarUrl(user.id, user.image) : undefined} />
              <AvatarFallback className="bg-white/[0.06] text-white/70">
                {(user?.name ?? user?.username ?? "P").charAt(0)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-white">
                {user?.username || user?.name || "PhewRunner"}
              </div>
              <div className="text-xs text-white/48">Level {level}</div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-lime-300">{xp.toLocaleString()}</span>
              <span className="text-white/46">/ {nextLevelXp.toLocaleString()} XP</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#a9ff34,#18d6a3)]"
                style={{ width: `${xpProgress}%` }}
              />
            </div>
          </div>

          <div className="rounded-[18px] border border-white/[0.08] bg-[radial-gradient(circle_at_right,rgba(45,212,191,0.18),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.015))] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/78">AI Trader Score</div>
            <div className="mt-2 flex items-end gap-1">
              <span className="text-3xl font-semibold text-[#19e6a7]">
                {typeof aiScore === "number" ? aiScore.toFixed(1) : "--"}
              </span>
              <span className="pb-1 text-xs text-white/44">/100</span>
            </div>
            <div className="mt-1 text-sm font-semibold text-[#a9ff34]">
              {typeof aiScore === "number" && aiScore >= 90 ? "Top 1%" : "Live ranking"}
            </div>
          </div>

          <div className="rounded-[18px] border border-white/[0.08] bg-white/[0.025] p-2.5">
            <div className="px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/36">Quick Actions</div>
            <div className="mt-2 grid gap-2">
              {[
                { label: "New Call", hint: "Share alpha", icon: Activity, onClick: () => navigate("/?compose=alpha") },
                { label: "Create Raid", hint: "Open raid room", icon: Flame, onClick: () => navigate("/raids") },
                { label: "AI Scan", hint: "Analyze token", icon: Zap, onClick: () => navigate("/bundle-checker") },
                { label: "Wallet Tracker", hint: "Smart money flow", icon: ShieldCheck, disabled: true },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={item.disabled ? undefined : item.onClick}
                    disabled={item.disabled}
                    title={item.disabled ? "Wallet tracker requires a wallet-flow endpoint before it can be enabled." : undefined}
                    className="flex items-center gap-2.5 rounded-[12px] border border-white/[0.07] bg-white/[0.03] px-2.5 py-2 text-left transition hover:border-lime-300/20 hover:bg-white/[0.055] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-white/[0.07] bg-black/20">
                      <Icon className="h-4 w-4 text-lime-300" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-white/82">{item.label}</span>
                      <span className="block truncate text-[10px] text-white/38">{item.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between px-1 pb-1 text-white/48">
            <button type="button" onClick={() => navigate("/profile")} className="rounded-xl p-2 hover:bg-white/[0.05] hover:text-white" aria-label="Profile settings">
              <Settings className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => navigate("/profile")} className="rounded-xl p-2 hover:bg-white/[0.05] hover:text-white" aria-label="Wallet security">
              <ShieldCheck className="h-4 w-4" />
            </button>
            <button type="button" disabled title="Language preferences require a localization settings endpoint." className="cursor-not-allowed rounded-xl p-2 opacity-45" aria-label="Language unavailable">
              <Globe2 className="h-4 w-4" />
            </button>
            <button type="button" onClick={signOut} className="rounded-xl p-2 hover:bg-white/[0.05] hover:text-white" aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
        </div>
      </aside>

      <div className="v2-mobile-nav lg:hidden">
        <SidebarNavItems mobile />
      </div>
    </>
  );
}
