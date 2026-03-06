import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { SharedAlphaUser, getAvatarUrl, formatTimeAgo } from "@/types";
import { LevelBadge } from "./LevelBar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Sparkles, RefreshCw, AlertCircle, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildProfilePath } from "@/lib/profile-path";

interface SharedAlphaDialogProps {
  postId: string;
  contractAddress?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCount?: number;
}

interface SharedAlphaResponse {
  users: SharedAlphaUser[];
  count: number;
}

export function SharedAlphaDialog({
  postId,
  contractAddress,
  open,
  onOpenChange,
  initialCount,
}: SharedAlphaDialogProps) {
  const navigate = useNavigate();
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["sharedAlpha", postId],
    queryFn: async () => {
      const response = await api.get<SharedAlphaResponse>(`/api/posts/${postId}/shared-alpha`);
      return response;
    },
    enabled: open,
    staleTime: 60000,
  });

  const users = data?.users ?? [];

  const handleUserClick = (user: SharedAlphaUser) => {
    onOpenChange(false);
    // Prefer username for cleaner URLs
    navigate(buildProfilePath(user.id, user.username));
  };

  const Content = (
    <div className="space-y-3 max-h-[60vh] overflow-y-auto">
      {isLoading ? (
        <>
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg">
              <Skeleton className="h-12 w-12 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm text-muted-foreground">Failed to load shared alpha</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </Button>
        </div>
      ) : users.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
          <Sparkles className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            You're the first to call this alpha!
          </p>
        </div>
      ) : (
        users.map((user) => (
          <button
            key={user.id}
            onClick={() => handleUserClick(user)}
            className={cn(
              "w-full flex items-center gap-3 p-3 rounded-lg transition-all",
              "hover:bg-secondary/80 active:bg-secondary",
              "border border-transparent hover:border-border"
            )}
          >
            <Avatar className="h-12 w-12 border-2 border-border">
              <AvatarImage src={getAvatarUrl(user.id, user.image)} />
              <AvatarFallback className="bg-muted text-sm">
                {user.name?.charAt(0) || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0 text-left">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground truncate">
                  {user.username || user.name}
                </span>
                <LevelBadge level={user.level} size="sm" />
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Posted {formatTimeAgo(user.postedAt)}
              </p>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
          </button>
        ))
      )}
    </div>
  );

  const count = initialCount ?? users.length;

  const title = (
    <div className="flex items-center gap-2">
      <Sparkles className="h-5 w-5 text-primary" />
      <span>Shared Alpha</span>
      {count > 0 && (
        <span className="text-sm text-muted-foreground">
          ({count} {count === 1 ? "trader" : "traders"})
        </span>
      )}
    </div>
  );

  const description = (
    <p className="text-sm text-muted-foreground">
      Other traders who called <code className="px-1.5 py-0.5 bg-secondary rounded text-xs font-mono">
        {contractAddress ? `${contractAddress.slice(0, 6)}...${contractAddress.slice(-4)}` : "this token"}
      </code> in the last 48 hours
    </p>
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <div className="pt-1">{description}</div>
          </DialogHeader>
          {Content}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="text-left">
          <DrawerTitle>{title}</DrawerTitle>
          <div className="pt-1">{description}</div>
        </DrawerHeader>
        <div className="px-4 pb-6">{Content}</div>
      </DrawerContent>
    </Drawer>
  );
}
