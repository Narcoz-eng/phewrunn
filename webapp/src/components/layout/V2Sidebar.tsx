import { Activity, Bell, Boxes, CandlestickChart, LogOut, Radar, Trophy, UserRound } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { BrandLogo } from "@/components/BrandLogo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { getAvatarUrl } from "@/types";

const navItems = [
  { to: "/", label: "Feed", icon: Activity, match: (pathname: string) => pathname === "/" },
  {
    to: "/terminal",
    label: "Terminal",
    icon: CandlestickChart,
    match: (pathname: string) => pathname.startsWith("/terminal") || pathname.startsWith("/token/"),
  },
  {
    to: "/bundle-checker",
    label: "Bundle Checker",
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
    to: "/notifications",
    label: "Notifications",
    icon: Bell,
    match: (pathname: string) => pathname.startsWith("/notifications"),
  },
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
  navItems[3],
  navItems[4],
  navItems[5],
].filter(Boolean);

function SidebarNavItems({ mobile = false }: { mobile?: boolean }) {
  const location = useLocation();
  const items = mobile ? mobileNavItems : navItems;

  return (
    <>
      {items.map((item) => {
        const active = item.match(location.pathname);
        return (
          <NavLink
            key={item.to}
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

  return (
    <>
      <aside className="v2-sidebar hidden lg:flex">
        <div className="flex items-center justify-between gap-3">
          <BrandLogo size="md" className="gap-3" />
          <div className="rounded-full border border-emerald-400/18 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
            Live
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
              style={{ width: `${Math.max(6, ((user?.xp ?? 0) % 1000) / 10)}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-white/42">
            <span>{(user?.xp ?? 0).toLocaleString()} XP</span>
            <span>Realtime enabled</span>
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
