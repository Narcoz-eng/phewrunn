import { useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LevelBadge } from "./LevelBar";
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
  const displayUsers = users.slice(0, maxDisplay);
  const remaining = totalCount - displayUsers.length;

  if (totalCount === 0) return null;

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

      <div className="flex items-center gap-2 flex-wrap">
        {displayUsers.length === 0 ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onShowMore();
            }}
            className="inline-flex items-center rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary/80"
          >
            View {totalCount} trader{totalCount === 1 ? "" : "s"}
          </button>
        ) : null}

        {/* Stacked Avatars */}
        <div className="flex -space-x-2">
          {displayUsers.map((user) => (
            <Avatar
              key={user.id}
              className="h-7 w-7 border-2 border-background cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all hover:z-10"
              onClick={(e) => handleUserClick(e, user)}
            >
              <AvatarImage src={getAvatarUrl(user.id, user.image)} />
              <AvatarFallback className="text-[9px] bg-muted">
                {user.name?.charAt(0) || "?"}
              </AvatarFallback>
            </Avatar>
          ))}
          {remaining > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onShowMore();
              }}
              className="h-7 w-7 rounded-full bg-secondary border-2 border-background flex items-center justify-center hover:bg-secondary/80 transition-colors"
            >
              <span className="text-[9px] font-medium text-muted-foreground">
                +{remaining}
              </span>
            </button>
          )}
        </div>

        {/* User Names */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {displayUsers.map((user, index) => (
            <span key={user.id} className="flex items-center gap-1">
              <button
                onClick={(e) => handleUserClick(e, user)}
                className="text-xs font-medium text-foreground hover:text-primary hover:underline transition-colors"
              >
                @{user.username || user.name}
              </button>
              <LevelBadge level={user.level} size="sm" className="text-[8px] px-1 py-0" />
              {index < displayUsers.length - 1 && remaining === 0 && (
                <span className="text-muted-foreground text-xs">,</span>
              )}
            </span>
          ))}
          {remaining > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onShowMore();
              }}
              className="text-xs text-primary hover:underline font-medium"
            >
              +{remaining} more
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
