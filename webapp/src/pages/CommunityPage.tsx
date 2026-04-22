import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Activity, ExternalLink, Flame, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-client";
import { V2PageHeader } from "@/components/layout/V2PageHeader";
import { V2EmptyState } from "@/components/ui/v2/V2EmptyState";
import { V2MetricCard } from "@/components/ui/v2/V2MetricCard";
import { V2StatusPill } from "@/components/ui/v2/V2StatusPill";
import { V2Surface } from "@/components/ui/v2/V2Surface";
import { TokenCommunitySection } from "@/components/token-community/TokenCommunitySection";
import type { TokenActiveRaidResponse, TokenCommunityProfile, TokenCommunityRoom } from "@/types";

function formatCompact(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export default function CommunityPage() {
  const navigate = useNavigate();
  const { tokenAddress = "" } = useParams<{ tokenAddress: string }>();
  const { user, canPerformAuthenticatedWrites } = useAuth();

  const profileQuery = useQuery<TokenCommunityProfile>({
    queryKey: ["community-page", "profile", tokenAddress],
    enabled: tokenAddress.length > 0,
    queryFn: async () => api.get<TokenCommunityProfile>(`/api/tokens/${tokenAddress}/community/profile`),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const roomQuery = useQuery<TokenCommunityRoom>({
    queryKey: ["community-page", "room", tokenAddress],
    enabled: tokenAddress.length > 0,
    queryFn: async () => api.get<TokenCommunityRoom>(`/api/tokens/${tokenAddress}/community/room`),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const activeRaidQuery = useQuery<TokenActiveRaidResponse>({
    queryKey: ["community-page", "raid", tokenAddress],
    enabled: tokenAddress.length > 0,
    queryFn: async () => api.get<TokenActiveRaidResponse>(`/api/tokens/${tokenAddress}/community/raids/active`),
    refetchOnWindowFocus: false,
    staleTime: 15_000,
  });

  const room = roomQuery.data ?? null;
  const profile = profileQuery.data ?? null;
  const activeRaid = activeRaidQuery.data?.campaign ?? null;

  return (
    <div className="space-y-5">
      <V2PageHeader
        title={profile?.xCashtag || room?.xCashtag || "Community"}
        description={profile?.headline || room?.headline || "Token community feed, contributors, and active raids surfaced through the existing token community stack."}
        badge={<V2StatusPill tone={activeRaid ? "live" : "default"}>{activeRaid ? "Raid Active" : "Community"}</V2StatusPill>}
        onBack={() => navigate(-1)}
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              to={`/token/${tokenAddress}?tab=community`}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/74 hover:bg-white/[0.08] hover:text-white"
            >
              Open token board
            </Link>
            {activeRaid ? (
              <Link
                to={`/raids/${tokenAddress}/${activeRaid.id}`}
                className="inline-flex items-center gap-2 rounded-2xl border border-lime-400/20 bg-lime-400/10 px-4 py-2 text-sm font-medium text-lime-300"
              >
                Active raid
                <ExternalLink className="h-4 w-4" />
              </Link>
            ) : null}
          </div>
        }
      />

      {roomQuery.isLoading ? (
        <V2Surface className="p-8">
          <div className="text-sm text-white/56">Loading community context...</div>
        </V2Surface>
      ) : roomQuery.isError || !room ? (
        <V2EmptyState
          icon={<Users className="h-7 w-7" />}
          title="Community unavailable"
          description="This token does not have a resolvable community room yet from the current community API."
        />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <V2MetricCard label="Members" value={formatCompact(room.memberCount)} hint="Joined community members" />
            <V2MetricCard label="Online" value={formatCompact(room.onlineNowEstimate)} hint="Estimated live presence" />
            <V2MetricCard label="Active Threads" value={formatCompact(room.activeThreadCount)} hint="Current thread volume" />
            <V2MetricCard
              label="Raid Pulse"
              value={formatCompact(room.currentRaidPulse?.participantCount ?? activeRaid?.participantCount ?? 0)}
              hint={room.currentRaidPulse?.label || (activeRaid ? "Active campaign" : "No live raid")}
              accent={activeRaid ? <Flame className="h-5 w-5 text-lime-300" /> : <Activity className="h-5 w-5 text-white/42" />}
            />
          </div>

          <Suspense fallback={<V2Surface className="p-8 text-sm text-white/56">Loading community surface...</V2Surface>}>
            <TokenCommunitySection
              tokenAddress={tokenAddress}
              tokenSymbol={profile?.xCashtag ?? null}
              tokenName={profile?.headline ?? room.headline ?? null}
              viewer={user}
              canPerformAuthenticatedWrites={canPerformAuthenticatedWrites}
            />
          </Suspense>
        </>
      )}
    </div>
  );
}
