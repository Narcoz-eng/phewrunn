import { Bell, Mail, Search } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-client";
import { getAvatarUrl } from "@/types";
import { cn } from "@/lib/utils";

export function V2PageTopbar({
  value,
  onChange,
  placeholder = "Search tokens, users, raids...",
  className,
}: {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const { user } = useAuth();

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex h-11 min-w-[260px] flex-1 items-center gap-3 rounded-[10px] border border-white/[0.08] bg-white/[0.035] px-4">
        <Search className="h-4 w-4 shrink-0 text-white/34" />
        <input
          value={value ?? ""}
          onChange={(event) => onChange?.(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/30"
          aria-label={placeholder}
        />
      </div>
      <Button type="button" variant="ghost" size="icon" className="h-11 w-11 rounded-[10px] border border-white/10 bg-white/[0.035] text-white/62 hover:bg-white/[0.07] hover:text-white">
        <Bell className="h-4 w-4" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="h-11 w-11 rounded-[10px] border border-white/10 bg-white/[0.035] text-white/62 hover:bg-white/[0.07] hover:text-white">
        <Mail className="h-4 w-4" />
      </Button>
      <Avatar className="h-11 w-11 border border-lime-300/20">
        <AvatarImage src={user ? getAvatarUrl(user.id, user.image) : undefined} />
        <AvatarFallback className="bg-white/[0.06] text-white/70">
          {(user?.name ?? user?.username ?? "P").charAt(0)}
        </AvatarFallback>
      </Avatar>
    </div>
  );
}
