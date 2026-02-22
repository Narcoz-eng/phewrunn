import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Reposter, getAvatarUrl } from "@/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { LevelBadge } from "./LevelBar";
import { useIsMobile } from "@/hooks/use-mobile";
import { Users, AlertCircle, RefreshCw, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface RepostersDialogProps {
  postId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCount: number;
}

function RepostersList({ postId, onClose }: { postId: string; onClose?: () => void }) {
  const navigate = useNavigate();
  const {
    data: reposters = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["reposters", postId],
    queryFn: async () => {
      const data = await api.get<Reposter[]>(`/api/posts/${postId}/reposters`);
      return data;
    },
    staleTime: 30000,
  });

  const handleUserClick = (reposter: Reposter) => {
    onClose?.();
    // Prefer username for cleaner URLs
    navigate(`/profile/${reposter.username || reposter.id}`);
  };

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
        <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
          <AlertCircle className="h-6 w-6 text-destructive" />
        </div>
        <p className="text-sm text-muted-foreground">Failed to load reposters</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Try Again
        </Button>
      </div>
    );
  }

  if (reposters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <Users className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">No reposters yet</p>
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-[400px]">
      <div className="space-y-1 p-4">
        {reposters.map((reposter) => (
          <button
            key={reposter.id}
            onClick={() => handleUserClick(reposter)}
            className={cn(
              "w-full flex items-center gap-3 p-3 rounded-lg text-left",
              "hover:bg-secondary/50 transition-colors cursor-pointer"
            )}
          >
            <Avatar className="h-10 w-10 border border-border">
              <AvatarImage src={getAvatarUrl(reposter.id, reposter.image)} />
              <AvatarFallback className="bg-muted text-muted-foreground text-sm">
                {reposter.name?.charAt(0) || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground truncate">
                  {reposter.username || reposter.name}
                </span>
                <LevelBadge level={reposter.level} />
              </div>
              <p className="text-xs text-muted-foreground">
                {reposter.xp.toLocaleString()} XP
              </p>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}

export function RepostersDialog({
  postId,
  open,
  onOpenChange,
  initialCount,
}: RepostersDialogProps) {
  const isMobile = useIsMobile();

  const title = `Shared by ${initialCount} ${initialCount === 1 ? "person" : "people"}`;

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          <DrawerHeader className="border-b border-border">
            <DrawerTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              {title}
            </DrawerTitle>
          </DrawerHeader>
          <RepostersList postId={postId} onClose={() => onOpenChange(false)} />
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            {title}
          </DialogTitle>
        </DialogHeader>
        <RepostersList postId={postId} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
