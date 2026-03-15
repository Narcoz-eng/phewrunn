import type { QueryClient } from "@tanstack/react-query";

type ProfileStatsLike = {
  posts?: number | null;
  followers?: number | null;
  following?: number | null;
  wins?: number | null;
  losses?: number | null;
};

type PublicProfileLike = {
  id?: string | null;
  username?: string | null;
  image?: string | null;
  level?: number | null;
  xp?: number | null;
  isVerified?: boolean;
  createdAt?: string | null;
  stats?: ProfileStatsLike | null;
};

type ExtendedProfileLike = {
  id: string;
  username?: string | null;
  image?: string | null;
  level?: number | null;
  xp?: number | null;
  isVerified?: boolean;
  createdAt?: string | null;
  followersCount?: number | null;
  followingCount?: number | null;
  postsCount?: number | null;
  winsCount?: number | null;
  lossesCount?: number | null;
};

type SessionCacheEnvelope<T> = {
  cachedAt: number;
  data: T;
};

export type ProfileCacheSnapshot = {
  id: string;
  username?: string | null;
  image?: string | null;
  level?: number | null;
  xp?: number | null;
  isVerified?: boolean;
  createdAt?: string | null;
  followersCount?: number | null;
  followingCount?: number | null;
  postsCount?: number | null;
  winsCount?: number | null;
  lossesCount?: number | null;
};

const USER_PROFILE_CACHE_PREFIX = "phew.user-profile:v3:";
const PROFILE_ME_CACHE_PREFIX = "phew.profile.me:";

function hasFiniteCount(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeMatchValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function trimValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isMatchingProfileSnapshot(
  profile: Pick<ProfileCacheSnapshot, "id" | "username"> | null | undefined,
  userId: string | null | undefined,
  username: string | null | undefined
): boolean {
  const normalizedUserId = normalizeMatchValue(userId);
  const normalizedUsername = normalizeMatchValue(username);
  const profileId = normalizeMatchValue(profile?.id);
  const profileUsername = normalizeMatchValue(profile?.username);

  if (normalizedUserId && profileId === normalizedUserId) {
    return true;
  }

  return Boolean(normalizedUsername && profileUsername === normalizedUsername);
}

function snapshotFromPublicProfile(profile: PublicProfileLike | null | undefined): ProfileCacheSnapshot | null {
  const id = trimValue(profile?.id);
  if (!id) {
    return null;
  }

  return {
    id,
    username: profile?.username ?? null,
    image: profile?.image ?? null,
    level: typeof profile?.level === "number" && Number.isFinite(profile.level) ? profile.level : null,
    xp: typeof profile?.xp === "number" && Number.isFinite(profile.xp) ? profile.xp : null,
    isVerified: typeof profile?.isVerified === "boolean" ? profile.isVerified : undefined,
    createdAt: profile?.createdAt ?? null,
    followersCount: hasFiniteCount(profile?.stats?.followers) ? profile.stats!.followers! : null,
    followingCount: hasFiniteCount(profile?.stats?.following) ? profile.stats!.following! : null,
    postsCount: hasFiniteCount(profile?.stats?.posts) ? profile.stats!.posts! : null,
    winsCount: hasFiniteCount(profile?.stats?.wins) ? profile.stats!.wins! : null,
    lossesCount: hasFiniteCount(profile?.stats?.losses) ? profile.stats!.losses! : null,
  };
}

function snapshotFromExtendedProfile(profile: ExtendedProfileLike | null | undefined): ProfileCacheSnapshot | null {
  const id = trimValue(profile?.id);
  if (!id) {
    return null;
  }

  return {
    id,
    username: profile?.username ?? null,
    image: profile?.image ?? null,
    level: typeof profile?.level === "number" && Number.isFinite(profile.level) ? profile.level : null,
    xp: typeof profile?.xp === "number" && Number.isFinite(profile.xp) ? profile.xp : null,
    isVerified: typeof profile?.isVerified === "boolean" ? profile.isVerified : undefined,
    createdAt: profile?.createdAt ?? null,
    followersCount: hasFiniteCount(profile?.followersCount) ? profile.followersCount : null,
    followingCount: hasFiniteCount(profile?.followingCount) ? profile.followingCount : null,
    postsCount: hasFiniteCount(profile?.postsCount) ? profile.postsCount : null,
    winsCount: hasFiniteCount(profile?.winsCount) ? profile.winsCount : null,
    lossesCount: hasFiniteCount(profile?.lossesCount) ? profile.lossesCount : null,
  };
}

function preferCount(
  current: number | null | undefined,
  incoming: number | null | undefined
): number | null | undefined {
  if (!hasFiniteCount(current)) {
    return incoming;
  }
  if (!hasFiniteCount(incoming)) {
    return current;
  }
  if (current === 0 && incoming !== 0) {
    return incoming;
  }
  return current;
}

function mergeSnapshot(
  current: ProfileCacheSnapshot | null,
  incoming: ProfileCacheSnapshot | null
): ProfileCacheSnapshot | null {
  if (!incoming) {
    return current;
  }
  if (!current) {
    return incoming;
  }

  return {
    id: current.id,
    username: current.username ?? incoming.username ?? null,
    image: current.image ?? incoming.image ?? null,
    level:
      typeof current.level === "number" && Number.isFinite(current.level)
        ? current.level
        : incoming.level ?? null,
    xp:
      typeof current.xp === "number" && Number.isFinite(current.xp)
        ? current.xp
        : incoming.xp ?? null,
    isVerified: typeof current.isVerified === "boolean" ? current.isVerified : incoming.isVerified,
    createdAt: current.createdAt ?? incoming.createdAt ?? null,
    followersCount: preferCount(current.followersCount, incoming.followersCount) ?? null,
    followingCount: preferCount(current.followingCount, incoming.followingCount) ?? null,
    postsCount: preferCount(current.postsCount, incoming.postsCount) ?? null,
    winsCount: preferCount(current.winsCount, incoming.winsCount) ?? null,
    lossesCount: preferCount(current.lossesCount, incoming.lossesCount) ?? null,
  };
}

function parseSessionCacheValue<T>(raw: string | null): T | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as SessionCacheEnvelope<T>;
    return parsed?.data ?? null;
  } catch {
    return null;
  }
}

function collectSessionProfileSnapshots(
  userId: string | null | undefined,
  username: string | null | undefined
): ProfileCacheSnapshot[] {
  if (typeof window === "undefined") {
    return [];
  }

  const snapshots: ProfileCacheSnapshot[] = [];

  try {
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (
        typeof key !== "string" ||
        (!key.startsWith(USER_PROFILE_CACHE_PREFIX) && !key.startsWith(PROFILE_ME_CACHE_PREFIX))
      ) {
        continue;
      }

      const raw = window.sessionStorage.getItem(key);
      if (!raw) continue;

      const profile = key.startsWith(USER_PROFILE_CACHE_PREFIX)
        ? snapshotFromPublicProfile(parseSessionCacheValue<PublicProfileLike>(raw))
        : snapshotFromExtendedProfile(parseSessionCacheValue<ExtendedProfileLike>(raw));

      if (!isMatchingProfileSnapshot(profile, userId, username)) {
        continue;
      }

      if (profile) {
        snapshots.push(profile);
      }
    }
  } catch {
    return snapshots;
  }

  return snapshots;
}

export function mergeProfileSnapshotIntoExtendedUser<T extends ExtendedProfileLike>(
  user: T,
  snapshot: ProfileCacheSnapshot | null | undefined
): T {
  if (!snapshot || !isMatchingProfileSnapshot(snapshot, user.id, user.username ?? null)) {
    return user;
  }

  return {
    ...user,
    username: user.username ?? snapshot.username ?? null,
    image: user.image ?? snapshot.image ?? null,
    level:
      typeof user.level === "number" && Number.isFinite(user.level) ? user.level : snapshot.level ?? undefined,
    xp: typeof user.xp === "number" && Number.isFinite(user.xp) ? user.xp : snapshot.xp ?? undefined,
    isVerified: typeof user.isVerified === "boolean" ? user.isVerified : snapshot.isVerified,
    createdAt: user.createdAt ?? snapshot.createdAt ?? null,
    followersCount: preferCount(user.followersCount, snapshot.followersCount) ?? user.followersCount ?? null,
    followingCount: preferCount(user.followingCount, snapshot.followingCount) ?? user.followingCount ?? null,
    postsCount: preferCount(user.postsCount, snapshot.postsCount) ?? user.postsCount ?? null,
    winsCount: preferCount(user.winsCount, snapshot.winsCount) ?? user.winsCount ?? null,
    lossesCount: preferCount(user.lossesCount, snapshot.lossesCount) ?? user.lossesCount ?? null,
  };
}

function mergeSnapshotIntoPublicProfile<T extends PublicProfileLike>(
  user: T,
  snapshot: ProfileCacheSnapshot | null | undefined
): T {
  if (!snapshot || !isMatchingProfileSnapshot(snapshot, user.id ?? null, user.username ?? null)) {
    return user;
  }

  const existingStats = user.stats ?? {};
  return {
    ...user,
    username: user.username ?? snapshot.username ?? null,
    image: user.image ?? snapshot.image ?? null,
    level:
      typeof user.level === "number" && Number.isFinite(user.level) ? user.level : snapshot.level ?? null,
    xp: typeof user.xp === "number" && Number.isFinite(user.xp) ? user.xp : snapshot.xp ?? null,
    isVerified: typeof user.isVerified === "boolean" ? user.isVerified : snapshot.isVerified,
    createdAt: user.createdAt ?? snapshot.createdAt ?? null,
    stats: {
      ...existingStats,
      posts: preferCount(existingStats.posts, snapshot.postsCount) ?? existingStats.posts ?? null,
      followers: preferCount(existingStats.followers, snapshot.followersCount) ?? existingStats.followers ?? null,
      following: preferCount(existingStats.following, snapshot.followingCount) ?? existingStats.following ?? null,
      wins: preferCount(existingStats.wins, snapshot.winsCount) ?? existingStats.wins ?? null,
      losses: preferCount(existingStats.losses, snapshot.lossesCount) ?? existingStats.losses ?? null,
    },
  };
}

export function getBestCachedProfileSnapshot(
  queryClient: QueryClient,
  userId: string | null | undefined,
  username: string | null | undefined
): ProfileCacheSnapshot | null {
  let snapshot: ProfileCacheSnapshot | null = null;

  const privateEntries = queryClient.getQueriesData<ExtendedProfileLike>({
    queryKey: ["profile", "me"],
  });
  for (const [, data] of privateEntries) {
    const nextSnapshot = snapshotFromExtendedProfile(data);
    if (!isMatchingProfileSnapshot(nextSnapshot, userId, username)) {
      continue;
    }
    snapshot = mergeSnapshot(snapshot, nextSnapshot);
  }

  const publicEntries = queryClient.getQueriesData<PublicProfileLike>({
    queryKey: ["userProfile"],
  });
  for (const [, data] of publicEntries) {
    const nextSnapshot = snapshotFromPublicProfile(data);
    if (!isMatchingProfileSnapshot(nextSnapshot, userId, username)) {
      continue;
    }
    snapshot = mergeSnapshot(snapshot, nextSnapshot);
  }

  for (const sessionSnapshot of collectSessionProfileSnapshots(userId, username)) {
    snapshot = mergeSnapshot(snapshot, sessionSnapshot);
  }

  return snapshot;
}

export function syncProfileSnapshotAcrossCaches(
  queryClient: QueryClient,
  snapshot: ProfileCacheSnapshot | null | undefined
): void {
  if (!snapshot?.id) {
    return;
  }

  queryClient.setQueriesData<ExtendedProfileLike>({ queryKey: ["profile", "me"] }, (existing) =>
    existing ? mergeProfileSnapshotIntoExtendedUser(existing, snapshot) : existing
  );
  queryClient.setQueriesData<PublicProfileLike>({ queryKey: ["userProfile"] }, (existing) =>
    existing ? mergeSnapshotIntoPublicProfile(existing, snapshot) : existing
  );

  if (typeof window === "undefined") {
    return;
  }

  const meKey = `${PROFILE_ME_CACHE_PREFIX}${snapshot.id}`;
  try {
    const currentMe = parseSessionCacheValue<ExtendedProfileLike>(window.sessionStorage.getItem(meKey));
    const nextMe = currentMe
      ? mergeProfileSnapshotIntoExtendedUser(currentMe, snapshot)
      : ({
          id: snapshot.id,
          username: snapshot.username ?? null,
          image: snapshot.image ?? null,
          level: snapshot.level ?? 0,
          xp: snapshot.xp ?? 0,
          isVerified: snapshot.isVerified,
          createdAt: snapshot.createdAt ?? null,
          followersCount: snapshot.followersCount ?? null,
          followingCount: snapshot.followingCount ?? null,
          postsCount: snapshot.postsCount ?? null,
          winsCount: snapshot.winsCount ?? null,
          lossesCount: snapshot.lossesCount ?? null,
        } satisfies ExtendedProfileLike);
    window.sessionStorage.setItem(
      meKey,
      JSON.stringify({
        cachedAt: Date.now(),
        data: nextMe,
      } satisfies SessionCacheEnvelope<ExtendedProfileLike>)
    );

    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (typeof key !== "string" || !key.startsWith(USER_PROFILE_CACHE_PREFIX)) {
        continue;
      }
      const currentProfile = parseSessionCacheValue<PublicProfileLike>(window.sessionStorage.getItem(key));
      if (!isMatchingProfileSnapshot(snapshotFromPublicProfile(currentProfile), snapshot.id, snapshot.username ?? null)) {
        continue;
      }
      const nextProfile = currentProfile
        ? mergeSnapshotIntoPublicProfile(currentProfile, snapshot)
        : ({
            id: snapshot.id,
            username: snapshot.username ?? null,
            image: snapshot.image ?? null,
            level: snapshot.level ?? null,
            xp: snapshot.xp ?? null,
            isVerified: snapshot.isVerified,
            createdAt: snapshot.createdAt ?? null,
            stats: {
              posts: snapshot.postsCount ?? null,
              followers: snapshot.followersCount ?? null,
              following: snapshot.followingCount ?? null,
              wins: snapshot.winsCount ?? null,
              losses: snapshot.lossesCount ?? null,
            },
          } satisfies PublicProfileLike);
      window.sessionStorage.setItem(
        key,
        JSON.stringify({
          cachedAt: Date.now(),
          data: nextProfile,
        } satisfies SessionCacheEnvelope<PublicProfileLike>)
      );
    }
  } catch {
    // Ignore storage access failures.
  }
}
