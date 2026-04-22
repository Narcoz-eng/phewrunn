import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Activity, ExternalLink, Flame, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { V2PageHeader } from "@/components/layout/V2PageHeader";
import { V2EmptyState } from "@/components/ui/v2/V2EmptyState";
import { V2MetricCard } from "@/components/ui/v2/V2MetricCard";
import { V2SectionHeader } from "@/components/ui/v2/V2SectionHeader";
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
  const heroImage = room?.assets.logo?.renderUrl || room?.assets.mascot?.renderUrl || room?.assets.banner?.renderUrl || undefined;

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
          <V2Surface tone="accent" className="relative overflow-hidden p-0">
            {room.assets.banner?.renderUrl ? (
              <div className="relative h-36 border-b border-white/8 sm:h-44">
                <div
                  className="absolute inset-0 bg-cover bg-center opacity-60"
                  style={{ backgroundImage: `url("${room.assets.banner.renderUrl}")` }}
                  aria-hidden="true"
                />
                <div
                  className="absolute inset-0 bg-[linear-gradient(180deg,rgba(1,4,9,0.2),rgba(1,4,9,0.88)),radial-gradient(circle_at_top_left,rgba(169,255,52,0.16),transparent_30%),radial-gradient(circle_at_top_right,rgba(45,212,191,0.12),transparent_30%)]"
                  aria-hidden="true"
                />
              </div>
            ) : (
              <div
                className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(169,255,52,0.14),transparent_28%),radial-gradient(circle_at_top_right,rgba(45,212,191,0.12),transparent_28%),linear-gradient(180deg,rgba(5,10,14,0.18),rgba(5,10,14,0.86))]"
                aria-hidden="true"
              />
            )}

            <div className="relative space-y-6 p-5 sm:p-6 lg:p-7">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 items-start gap-4">
                  <Avatar className="h-24 w-24 rounded-[28px] border border-lime-300/20 shadow-[0_24px_64px_-28px_rgba(169,255,52,0.42)]">
                    <AvatarImage src={heroImage} />
                    <AvatarFallback className="bg-white/[0.04] text-2xl font-semibold text-white">
                      {(profile?.xCashtag || room.xCashtag || "C").charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <V2StatusPill tone="live">{activeRaid ? "Raid Live" : "Room Open"}</V2StatusPill>
                      <V2StatusPill tone="xp">{room.viewer.joined ? "Member" : "Public Community"}</V2StatusPill>
                    </div>
                    <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                      {profile?.xCashtag || room.xCashtag || "Community"}
                    </h2>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">
                      {profile?.headline || room.headline || "Token room for calls, raids, and shared alpha."}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {room.vibeTags.length ? room.vibeTags.slice(0, 6).map((tag) => (
                        <span key={tag} className="rounded-full border border-lime-300/14 bg-lime-300/8 px-3 py-1 text-[11px] font-medium text-lime-200/90">
                          {tag}
                        </span>
                      )) : (
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-white/56">
                          {room.viewer.joined ? "Joined room" : "Open to join"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid w-full gap-3 sm:grid-cols-2 lg:w-[360px]">
                  <V2Surface tone="soft" className="p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Live Members</div>
                    <div className="mt-3 text-3xl font-semibold text-white">{formatCompact(room.onlineNowEstimate)}</div>
                    <div className="mt-2 text-sm text-white/50">Estimated active presence right now</div>
                  </V2Surface>
                  <V2Surface tone="soft" className="p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Current Raid</div>
                    <div className="mt-3 text-3xl font-semibold text-white">
                      {activeRaid ? formatCompact(activeRaid.participantCount) : "--"}
                    </div>
                    <div className="mt-2 text-sm text-white/50">
                      {activeRaid ? "Raid participants" : "No active campaign"}
                    </div>
                  </V2Surface>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <V2MetricCard label="Members" value={formatCompact(room.memberCount)} hint="Joined community members" />
                <V2MetricCard label="Online" value={formatCompact(room.onlineNowEstimate)} hint="Estimated live presence" />
                <V2MetricCard label="Threads" value={formatCompact(room.activeThreadCount)} hint="Current discussion volume" />
                <V2MetricCard
                  label="Raid Pulse"
                  value={formatCompact(room.currentRaidPulse?.participantCount ?? activeRaid?.participantCount ?? 0)}
                  hint={room.currentRaidPulse?.label || (activeRaid ? "Active campaign" : "No live raid")}
                  accent={activeRaid ? <Flame className="h-5 w-5 text-lime-300" /> : <Activity className="h-5 w-5 text-white/42" />}
                />
              </div>
            </div>
          </V2Surface>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_360px]">
            <V2Surface className="p-5 sm:p-6">
              <V2SectionHeader
                eyebrow="Community Operating Stack"
                title="Pinned context and contributor pulse"
                description="Built from the current room/profile response without duplicating the deeper thread/raid flows already implemented."
              />
              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-5">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Suggested thread</div>
                  {room.suggestedThread ? (
                    <>
                      <div className="mt-3 text-base font-semibold text-white">
                        {room.suggestedThread.title || "Open topic"}
                      </div>
                      <div className="mt-2 text-sm leading-6 text-white/58">{room.suggestedThread.content}</div>
                    </>
                  ) : (
                    <div className="mt-3 text-sm text-white/50">No suggested thread is pinned yet.</div>
                  )}
                </div>

                <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-5">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Why this room exists</div>
                  <div className="mt-3 text-sm leading-6 text-white/58">
                    {room.whyLine || profile?.whyLine || room.welcomePrompt || "Share calls, coordinate raids, and keep token intelligence social."}
                  </div>
                </div>
              </div>
            </V2Surface>

            <div className="space-y-4">
              <V2Surface className="p-5" tone="soft">
                <V2SectionHeader
                  eyebrow="Contributors"
                  title="Room leaders"
                  description="Current top contributors from the room response."
                />
                <div className="mt-4 space-y-3">
                  {room.topContributors.slice(0, 5).map((contributor, index) => (
                    <div key={contributor.user.id} className="flex items-center justify-between gap-4 rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/8 bg-white/[0.04] text-sm font-semibold text-white/82">
                          {index + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-white">
                            {contributor.user.username || contributor.user.name}
                          </div>
                          <div className="text-xs text-white/42">{contributor.badge} • streak {contributor.currentRaidStreak}</div>
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-lime-300">
                        {formatCompact(contributor.contributionScore)}
                      </div>
                    </div>
                  ))}
                </div>
              </V2Surface>

              <V2Surface className="p-5" tone="soft">
                <V2SectionHeader
                  eyebrow="Recent Members"
                  title="Fresh joins"
                  description="Newest visible members in the current room snapshot."
                />
                <div className="mt-4 flex flex-wrap gap-2">
                  {room.recentMembers.slice(0, 8).map((member) => (
                    <span key={`${member.user.id}:${member.joinedAt}`} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-sm text-white/68">
                      {member.user.username || member.user.name}
                    </span>
                  ))}
                </div>
              </V2Surface>
            </div>
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
