import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ProfileBanner } from "./ProfileBanner";
import { LevelBadge } from "@/components/feed/LevelBar";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { getAvatarUrl } from "@/types";
import { toast } from "sonner";
import { Link2, Share2 } from "lucide-react";

interface ShareableProfileCardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: {
    id: string;
    username: string | null;
    name?: string | null;
    image: string | null;
    level: number;
    xp: number;
    isVerified?: boolean;
    bannerImage?: string | null;
    stats?: {
      wins: number;
      losses: number;
      winRate: number;
      totalCalls: number;
    };
  };
}

export function ShareableProfileCard({ open, onOpenChange, user }: ShareableProfileCardProps) {
  const profileUrl = `${window.location.origin}/${user.username ?? user.id}`;
  const handle = user.username ? `@${user.username}` : user.name ?? "Unknown";
  const avatarSeed = user.username ?? user.id;
  const winRate = user.stats?.winRate ?? 0;
  const wins = user.stats?.wins ?? 0;
  const losses = user.stats?.losses ?? 0;
  const totalCalls = user.stats?.totalCalls ?? 0;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(profileUrl);
      toast.success("Profile link copied!");
    } catch {
      toast.error("Failed to copy link");
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${handle} on phewrunn`,
          text: `Check out ${handle}'s profile on phewrunn`,
          url: profileUrl,
        });
      } catch (err) {
        // User cancelled or share failed — fall back to copy
        if ((err as Error).name !== "AbortError") {
          await copyLink();
        }
      }
    } else {
      await copyLink();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm p-4">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Share Profile
          </DialogTitle>
        </DialogHeader>

        {/* Shareable Card Preview */}
        <div className="rounded-xl overflow-hidden border border-border bg-[#0a0a0f] shadow-xl">
          {/* Banner */}
          <div className="relative">
            <ProfileBanner bannerImage={user.bannerImage} className="h-20" />

            {/* Avatar overlapping banner */}
            <div className="absolute -bottom-7 left-4">
              <Avatar className="h-14 w-14 border-3 border-[#0a0a0f] ring-2 ring-border">
                <AvatarImage src={getAvatarUrl(avatarSeed, user.image)} />
                <AvatarFallback className="bg-muted text-muted-foreground text-xl">
                  {(user.username ?? user.name ?? "?").charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </div>
          </div>

          {/* Card body */}
          <div className="pt-9 px-4 pb-4 space-y-3">
            {/* Handle + verified + level */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-foreground text-base leading-tight">{handle}</span>
                  {user.isVerified ? <VerifiedBadge size="sm" /> : null}
                </div>
                {user.name && user.username ? (
                  <p className="text-xs text-muted-foreground mt-0.5">{user.name}</p>
                ) : null}
              </div>
              <LevelBadge level={user.level} size="md" showLabel />
            </div>

            {/* Stat pills */}
            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary border border-border text-xs font-mono">
                <span className="text-muted-foreground">Win Rate</span>
                <span className="font-bold text-foreground">{winRate.toFixed(1)}%</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary border border-border text-xs font-mono">
                <span className="text-muted-foreground">W/L</span>
                <span className="font-bold text-foreground">
                  {wins}/{losses}
                </span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary border border-border text-xs font-mono">
                <span className="text-muted-foreground">Calls</span>
                <span className="font-bold text-foreground">{totalCalls}</span>
              </div>
            </div>

            {/* Watermark */}
            <div className="flex justify-end">
              <span className="text-[10px] text-muted-foreground/50 font-mono tracking-wider">
                phew.run
              </span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mt-1">
          <Button variant="outline" className="flex-1 gap-1.5 text-sm" onClick={copyLink}>
            <Link2 className="h-3.5 w-3.5" />
            Copy Link
          </Button>
          <Button className="flex-1 gap-1.5 text-sm" onClick={handleShare}>
            <Share2 className="h-3.5 w-3.5" />
            Share
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
