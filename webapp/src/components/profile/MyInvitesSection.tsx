import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { type MyInviteInfo } from "../../../../backend/src/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { UserPlus, Copy, Check, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { getAvatarUrl } from "@/types";

export function MyInvitesSection() {
  const [copied, setCopied] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["invites", "me"],
    queryFn: () => api.get<MyInviteInfo>("/api/invites/me"),
    retry: false,
  });

  const handleCopy = async () => {
    if (!data?.inviteLink) return;
    try {
      await navigator.clipboard.writeText(data.inviteLink);
      setCopied(true);
      toast.success("Invite link copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy link");
    }
  };

  if (isError) return null;

  return (
    <Card className="rounded-[28px] border border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <UserPlus className="h-4 w-4 text-primary" />
          My Invites
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-5 w-40 rounded-full" />
          </div>
        ) : data ? (
          <>
            {/* Invite link row */}
            <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-card/50 px-3 py-2.5">
              <LinkIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                {data.inviteLink}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 shrink-0 p-0"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-gain" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>

            {/* Quota */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Invites remaining</span>
              <span className="font-semibold tabular-nums">
                {data.quotaRemaining}{" "}
                <span className="text-muted-foreground font-normal">
                  of {data.quotaTotal}
                </span>
              </span>
            </div>

            {/* Quota bar */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/60">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{
                  width: data.quotaTotal > 0
                    ? `${Math.round((data.quotaUsed / data.quotaTotal) * 100)}%`
                    : "0%",
                }}
              />
            </div>

            {/* Invitees */}
            {data.invitees.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Invited ({data.invitees.length})
                </p>
                <div className="space-y-2">
                  {data.invitees.map((invitee) => (
                    <div
                      key={invitee.id}
                      className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-card/60 transition-colors"
                    >
                      <Avatar className="h-7 w-7 shrink-0">
                        <AvatarImage src={invitee.image ? getAvatarUrl(invitee.image) : undefined} />
                        <AvatarFallback className="text-[10px]">
                          {(invitee.username ?? "?").slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">
                        {invitee.username ? `@${invitee.username}` : "Anonymous"}
                      </span>
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        {new Date(invitee.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-center text-xs text-muted-foreground py-2">
                No invites sent yet. Share your link to invite friends.
              </p>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
