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
  const displayUsers = safeUsers.slice(0, maxDisplay);
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

      <div className="flex items-center gap-3 flex-wrap">
        {displayUsers.length === 0 ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onShowMore();
            }}
            className="inline-flex items-center rounded-full border border-border/70 bg-secondary/70 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
          >
            View {totalCount} trader{totalCount === 1 ? "" : "s"}
          </button>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShowMore();
            }}
            className="flex -space-x-2"
            aria-label={`View ${totalCount} traders who also called this token`}
          >
          {displayUsers.map((user) => (
            <Avatar
              key={user.id}
              className="h-8 w-8 border-2 border-background cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all hover:z-10"
              onClick={(e) => handleUserClick(e, user)}
            >
              <AvatarImage src={getAvatarUrl(user.id, user.image)} />
              <AvatarFallback className="text-[10px] bg-muted">
                {user.name?.charAt(0) || "?"}
              </AvatarFallback>
            </Avatar>
          ))}
          {remaining > 0 && (
            <span className="h-8 w-8 rounded-full bg-secondary border-2 border-background flex items-center justify-center">
              <span className="text-[10px] font-medium text-muted-foreground">
                +{remaining}
              </span>
            </span>
          )}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShowMore();
            }}
            className="inline-flex items-center rounded-full border border-border/70 bg-secondary/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
          >
            {totalCount} trader{totalCount === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
