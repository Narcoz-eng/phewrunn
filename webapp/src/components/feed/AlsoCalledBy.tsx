import { useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SharedAlphaUser, getAvatarUrl } from "@/types";
import { cn } from "@/lib/utils";
import { buildProfilePath } from "@/lib/profile-path";
import { Sparkles } from "lucide-react";

interface AlsoCalledByProps {
  users: SharedAlphaUser[];
  totalCount: number;
  onShowMore: () => void;
  maxDisplay?: number;
  className?: string;
}

export function AlsoCalledBy({
  users,
  totalCount,
  onShowMore,
  maxDisplay = 3,
  className,
}: AlsoCalledByProps) {
  const navigate = useNavigate();
  const safeUsers = Array.isArray(users) ? users : [];
  const normalizedTotalCount = Math.max(totalCount, safeUsers.length);
  const displayUsers = safeUsers.slice(0, maxDisplay);
  const remaining = Math.max(0, normalizedTotalCount - displayUsers.length);

  if (normalizedTotalCount === 0) return null;

  const handleUserClick = (e: React.MouseEvent, user: SharedAlphaUser) => {
    e.stopPropagation();
    navigate(buildProfilePath(user.id, user.username));
  };

  return (
    <div className={cn("mt-3", className)}>
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="h-3.5 w-3.5 text-accent" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Also Called By
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {displayUsers.length === 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShowMore();
            }}
            className="inline-flex h-9 items-center rounded-full border border-border/70 bg-secondary/70 px-3.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
          >
            View {normalizedTotalCount} trader{normalizedTotalCount === 1 ? "" : "s"}
          </button>
        ) : null}

        {displayUsers.length > 0 ? (
          <div className="flex items-center gap-2.5">
            <div
              className="flex items-center -space-x-2"
              aria-label={`Preview of ${normalizedTotalCount} traders who also called this token`}
            >
              {displayUsers.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={(e) => handleUserClick(e, user)}
                  className="relative rounded-full transition-transform hover:z-10 hover:scale-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  aria-label={`Open ${user.username || user.name || "user"} profile`}
                >
                  <Avatar className="h-8 w-8 border-2 border-background shadow-[0_10px_18px_-16px_hsl(var(--foreground)/0.3)] dark:shadow-none">
                    <AvatarImage src={getAvatarUrl(user.id, user.image)} />
                    <AvatarFallback className="text-[10px] bg-muted">
                      {user.name?.charAt(0) || "?"}
                    </AvatarFallback>
                  </Avatar>
                </button>
              ))}
              {remaining > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onShowMore();
                  }}
                  className="relative z-[1] inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-secondary text-[10px] font-medium text-muted-foreground shadow-[0_10px_18px_-16px_hsl(var(--foreground)/0.3)] transition-colors hover:bg-secondary/90 dark:shadow-none"
                >
                  +{remaining}
                </button>
              )}
            </div>

            <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShowMore();
            }}
            className="inline-flex h-9 items-center rounded-full border border-border/70 bg-secondary/60 px-3.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
            aria-label={`View ${normalizedTotalCount} traders who also called this token`}
          >
            {normalizedTotalCount} trader{normalizedTotalCount === 1 ? "" : "s"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
