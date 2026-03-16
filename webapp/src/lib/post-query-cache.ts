import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { Post } from "@/types";

type FeedPageLike = {
  items: Post[];
};

type TokenPageLike = {
  recentCalls?: Post[];
};

type IntelligenceLeaderboardsCacheLike = {
  topAlphaToday?: Post[];
  biggestRoiToday?: Post[];
  bestEntryToday?: Post[];
};

type FollowableProfileLike = {
  id?: string | null;
  username?: string | null;
  isFollowing?: boolean;
};

type SessionCacheEnvelope<T> = {
  cachedAt: number;
  data?: T;
  page?: {
    items?: T extends Post[] ? Post[] : Post[];
  };
};

const FEED_FIRST_PAGE_CACHE_PREFIX = "phew.feed.first-page.v3";
const PROFILE_POSTS_CACHE_PREFIX = "phew.profile.posts:";
const PROFILE_REPOSTS_CACHE_PREFIX = "phew.profile.reposts:";
const USER_POSTS_CACHE_PREFIX = "phew.user-posts:";
const USER_REPOSTS_CACHE_PREFIX = "phew.user-reposts:";

function dedupePushPost(target: Post[], seenIds: Set<string>, candidate: Post | null | undefined): void {
  if (!candidate?.id || seenIds.has(candidate.id)) {
    return;
  }
  seenIds.add(candidate.id);
  target.push(candidate);
}

function dedupePushPostArray(target: Post[], seenIds: Set<string>, candidates: Post[] | null | undefined): void {
  for (const candidate of candidates ?? []) {
    dedupePushPost(target, seenIds, candidate);
  }
}

function normalizeIdentifier(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function syncPostsInSessionCache(
  author: Pick<Post["author"], "id" | "username">,
  nextFollowing: boolean
): void {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedUsername = normalizeIdentifier(author.username);
  const matchesAuthor = (post: Post): boolean =>
    post.author.id === author.id ||
    post.authorId === author.id ||
    (normalizedUsername !== null && normalizeIdentifier(post.author.username) === normalizedUsername);
  const syncPost = (post: Post): Post =>
    matchesAuthor(post) ? { ...post, isFollowingAuthor: nextFollowing } : post;

  try {
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (
        typeof key !== "string" ||
        (!key.startsWith(FEED_FIRST_PAGE_CACHE_PREFIX) &&
          !key.startsWith(PROFILE_POSTS_CACHE_PREFIX) &&
          !key.startsWith(PROFILE_REPOSTS_CACHE_PREFIX) &&
          !key.startsWith(USER_POSTS_CACHE_PREFIX) &&
          !key.startsWith(USER_REPOSTS_CACHE_PREFIX))
      ) {
        continue;
      }

      const raw = window.sessionStorage.getItem(key);
      if (!raw) continue;

      const parsed = JSON.parse(raw) as SessionCacheEnvelope<Post[]>;
      if (key.startsWith(FEED_FIRST_PAGE_CACHE_PREFIX)) {
        const currentItems = parsed?.page?.items;
        if (!Array.isArray(currentItems)) {
          continue;
        }
        const nextItems = currentItems.map(syncPost);
        window.sessionStorage.setItem(
          key,
          JSON.stringify({
            ...parsed,
            page: {
              ...(parsed.page ?? {}),
              items: nextItems,
            },
          } satisfies SessionCacheEnvelope<Post[]>)
        );
        continue;
      }

      const currentData = parsed?.data;
      if (!Array.isArray(currentData)) {
        continue;
      }
      const nextData = currentData.map(syncPost);
      window.sessionStorage.setItem(
        key,
        JSON.stringify({
          ...parsed,
          data: nextData,
        } satisfies SessionCacheEnvelope<Post[]>)
      );
    }
  } catch {
    // Ignore sessionStorage failures.
  }
}

function collectSessionCachedPosts(): Post[] {
  if (typeof window === "undefined") {
    return [];
  }

  const posts: Post[] = [];
  const seenIds = new Set<string>();

  try {
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (
        typeof key !== "string" ||
        (!key.startsWith(FEED_FIRST_PAGE_CACHE_PREFIX) &&
          !key.startsWith(PROFILE_POSTS_CACHE_PREFIX) &&
          !key.startsWith(PROFILE_REPOSTS_CACHE_PREFIX) &&
          !key.startsWith(USER_POSTS_CACHE_PREFIX) &&
          !key.startsWith(USER_REPOSTS_CACHE_PREFIX))
      ) {
        continue;
      }

      const raw = window.sessionStorage.getItem(key);
      if (!raw) continue;

      const parsed = JSON.parse(raw) as SessionCacheEnvelope<Post[]>;
      if (key.startsWith(FEED_FIRST_PAGE_CACHE_PREFIX)) {
        dedupePushPostArray(posts, seenIds, parsed?.page?.items);
        continue;
      }

      dedupePushPostArray(posts, seenIds, parsed?.data);
    }
  } catch {
    return posts;
  }

  return posts;
}

function pickPreferredPost(existing: Post | undefined, candidate: Post): Post {
  if (!existing) {
    return candidate;
  }

  const existingIntelligenceVersion = existing.lastIntelligenceAt ? new Date(existing.lastIntelligenceAt).getTime() : 0;
  const candidateIntelligenceVersion = candidate.lastIntelligenceAt ? new Date(candidate.lastIntelligenceAt).getTime() : 0;
  if (candidateIntelligenceVersion > existingIntelligenceVersion) {
    return candidate;
  }

  const existingRichness =
    Number(Boolean(existing.currentMcap)) +
    Number(Boolean(existing.mcap1h)) +
    Number(Boolean(existing.mcap6h)) +
    Number(Boolean(existing.tokenRiskScore)) +
    Number(Boolean(existing.bundleRiskLabel)) +
    Number(Boolean(existing.confidenceScore));
  const candidateRichness =
    Number(Boolean(candidate.currentMcap)) +
    Number(Boolean(candidate.mcap1h)) +
    Number(Boolean(candidate.mcap6h)) +
    Number(Boolean(candidate.tokenRiskScore)) +
    Number(Boolean(candidate.bundleRiskLabel)) +
    Number(Boolean(candidate.confidenceScore));

  return candidateRichness > existingRichness ? candidate : existing;
}

function buildPostLookup(posts: Post[] | null | undefined): Map<string, Post> {
  const lookup = new Map<string, Post>();
  for (const post of posts ?? []) {
    if (!post?.id) continue;
    lookup.set(post.id, pickPreferredPost(lookup.get(post.id), post));
  }
  return lookup;
}

function syncPostArrayFromLookup(
  posts: Post[] | undefined,
  lookup: ReadonlyMap<string, Post>
): Post[] | undefined {
  if (!Array.isArray(posts) || posts.length === 0 || lookup.size === 0) {
    return posts;
  }

  let didChange = false;
  const nextPosts = posts.map((post) => {
    const candidate = lookup.get(post.id);
    if (!candidate) {
      return post;
    }

    const nextPost = pickPreferredPost(post, candidate);
    if (nextPost !== post) {
      didChange = true;
    }
    return nextPost;
  });

  return didChange ? nextPosts : posts;
}

export function mergePreferredPostCollections(
  primary: Post[] | null | undefined,
  fallback: Post[] | null | undefined
): Post[] {
  const orderedIds: string[] = [];
  const mergedById = new Map<string, Post>();
  const rememberPost = (post: Post | null | undefined) => {
    if (!post?.id) {
      return;
    }
    if (!mergedById.has(post.id)) {
      orderedIds.push(post.id);
    }
    mergedById.set(post.id, pickPreferredPost(mergedById.get(post.id), post));
  };

  for (const post of primary ?? []) {
    rememberPost(post);
  }
  for (const post of fallback ?? []) {
    rememberPost(post);
  }

  return orderedIds.map((id) => mergedById.get(id)!).filter(Boolean);
}

export function collectCachedPosts(queryClient: QueryClient): Post[] {
  const postsById = new Map<string, Post>();
  const rememberPost = (candidate: Post | null | undefined) => {
    if (!candidate?.id) {
      return;
    }
    postsById.set(candidate.id, pickPreferredPost(postsById.get(candidate.id), candidate));
  };
  const rememberPostArray = (candidates: Post[] | null | undefined) => {
    for (const candidate of candidates ?? []) {
      rememberPost(candidate);
    }
  };

  const feedEntries = queryClient.getQueriesData<InfiniteData<FeedPageLike>>({
    queryKey: ["posts"],
  });
  for (const [, data] of feedEntries) {
    for (const page of data?.pages ?? []) {
      rememberPostArray(page.items);
    }
  }

  const arrayPrefixes: ReadonlyArray<readonly string[]> = [
    ["userPosts"],
    ["userReposts"],
    ["profile", "posts"],
    ["profile", "reposts"],
    ["token-calls"],
  ];
  for (const prefix of arrayPrefixes) {
    const entries = queryClient.getQueriesData<Post[]>({ queryKey: prefix });
    for (const [, data] of entries) {
      rememberPostArray(data);
    }
  }

  const tokenPageEntries = queryClient.getQueriesData<TokenPageLike>({
    queryKey: ["token-page"],
  });
  for (const [, data] of tokenPageEntries) {
    rememberPostArray(data?.recentCalls);
  }

  const detailEntries = queryClient.getQueriesData<Post>({
    queryKey: ["post"],
  });
  for (const [, data] of detailEntries) {
    rememberPost(data);
  }

  for (const post of collectSessionCachedPosts()) {
    rememberPost(post);
  }

  const posts = Array.from(postsById.values());
  posts.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  return posts;
}

export function findCachedPost(queryClient: QueryClient, postId: string | null | undefined): Post | null {
  if (!postId) {
    return null;
  }

  const direct = queryClient.getQueryData<Post>(["post", postId]);
  if (direct) {
    return direct;
  }

  return collectCachedPosts(queryClient).find((post) => post.id === postId) ?? null;
}

export function getCachedPostsForAuthor(queryClient: QueryClient, identifier: string | null | undefined): Post[] {
  if (!identifier) {
    return [];
  }

  const normalizedIdentifier = identifier.trim().toLowerCase();
  return collectCachedPosts(queryClient).filter((post) => {
    const username = post.author.username?.trim().toLowerCase();
    return (
      post.authorId === identifier ||
      post.author.id === identifier ||
      username === normalizedIdentifier
    );
  });
}

export function getCachedPostsForToken(queryClient: QueryClient, tokenAddress: string | null | undefined): Post[] {
  const normalizedTokenAddress = normalizeIdentifier(tokenAddress);
  if (!normalizedTokenAddress) {
    return [];
  }

  return collectCachedPosts(queryClient).filter((post) => {
    const normalizedPostAddress = normalizeIdentifier(post.contractAddress);
    return normalizedPostAddress === normalizedTokenAddress;
  });
}

export function syncPostsIntoQueryCache(queryClient: QueryClient, posts: Post[] | null | undefined): void {
  const lookup = buildPostLookup(posts);
  if (lookup.size === 0) {
    return;
  }

  for (const post of lookup.values()) {
    if (!post?.id) continue;
    queryClient.setQueryData<Post>(["post", post.id], (existing) => pickPreferredPost(existing, post));
  }

  queryClient.setQueriesData<InfiniteData<FeedPageLike>>({ queryKey: ["posts"] }, (current) => {
    if (!current) return current;

    let didChange = false;
    const nextPages = current.pages.map((page) => {
      const nextItems = syncPostArrayFromLookup(page.items, lookup);
      if (nextItems !== page.items) {
        didChange = true;
        return {
          ...page,
          items: nextItems ?? page.items,
        };
      }
      return page;
    });

    return didChange ? { ...current, pages: nextPages } : current;
  });

  const syncArrayCache = (queryKey: readonly string[]) => {
    queryClient.setQueriesData<Post[]>({ queryKey }, (current) => syncPostArrayFromLookup(current, lookup) ?? current);
  };

  syncArrayCache(["userPosts"]);
  syncArrayCache(["userReposts"]);
  syncArrayCache(["profile", "posts"]);
  syncArrayCache(["profile", "reposts"]);
  syncArrayCache(["token-calls"]);

  queryClient.setQueriesData<TokenPageLike>({ queryKey: ["token-page"] }, (current) => {
    if (!current) return current;
    const nextRecentCalls = syncPostArrayFromLookup(current.recentCalls, lookup);
    return nextRecentCalls === current.recentCalls
      ? current
      : {
          ...current,
          recentCalls: nextRecentCalls ?? current.recentCalls,
        };
  });

  queryClient.setQueriesData<IntelligenceLeaderboardsCacheLike>({ queryKey: ["leaderboards"] }, (current) => {
    if (!current) return current;

    const nextTopAlphaToday = syncPostArrayFromLookup(current.topAlphaToday, lookup);
    const nextBiggestRoiToday = syncPostArrayFromLookup(current.biggestRoiToday, lookup);
    const nextBestEntryToday = syncPostArrayFromLookup(current.bestEntryToday, lookup);

    if (
      nextTopAlphaToday === current.topAlphaToday &&
      nextBiggestRoiToday === current.biggestRoiToday &&
      nextBestEntryToday === current.bestEntryToday
    ) {
      return current;
    }

    return {
      ...current,
      topAlphaToday: nextTopAlphaToday ?? current.topAlphaToday,
      biggestRoiToday: nextBiggestRoiToday ?? current.biggestRoiToday,
      bestEntryToday: nextBestEntryToday ?? current.bestEntryToday,
    };
  });
}

export function syncFollowStateAcrossPostCaches(
  queryClient: QueryClient,
  author: Pick<Post["author"], "id" | "username">,
  nextFollowing: boolean
): void {
  const normalizedUsername = normalizeIdentifier(author.username);
  const matchesAuthor = (post: Post): boolean =>
    post.author.id === author.id ||
    post.authorId === author.id ||
    (normalizedUsername !== null && normalizeIdentifier(post.author.username) === normalizedUsername);
  const syncPost = (post: Post): Post =>
    matchesAuthor(post) ? { ...post, isFollowingAuthor: nextFollowing } : post;

  queryClient.setQueriesData<InfiniteData<FeedPageLike>>({ queryKey: ["posts"] }, (current) => {
    if (!current) return current;
    return {
      ...current,
      pages: current.pages.map((page) => ({
        ...page,
        items: page.items.map(syncPost),
      })),
    };
  });

  queryClient.setQueriesData<Post[]>({ queryKey: ["userPosts"] }, (current) => current?.map(syncPost) ?? current);
  queryClient.setQueriesData<Post[]>({ queryKey: ["userReposts"] }, (current) => current?.map(syncPost) ?? current);
  queryClient.setQueriesData<Post[]>({ queryKey: ["profile", "posts"] }, (current) =>
    current?.map(syncPost) ?? current
  );
  queryClient.setQueriesData<Post[]>({ queryKey: ["profile", "reposts"] }, (current) =>
    current?.map(syncPost) ?? current
  );
  queryClient.setQueriesData<TokenPageLike>({ queryKey: ["token-page"] }, (current) => {
    if (!current) return current;
    return {
      ...current,
      recentCalls: current.recentCalls?.map(syncPost) ?? current.recentCalls,
    };
  });
  queryClient.setQueriesData<IntelligenceLeaderboardsCacheLike>({ queryKey: ["leaderboards"] }, (current) => {
    if (!current) return current;
    return {
      ...current,
      topAlphaToday: current.topAlphaToday?.map(syncPost) ?? current.topAlphaToday,
      biggestRoiToday: current.biggestRoiToday?.map(syncPost) ?? current.biggestRoiToday,
      bestEntryToday: current.bestEntryToday?.map(syncPost) ?? current.bestEntryToday,
    };
  });
  queryClient.setQueriesData<Post>({ queryKey: ["post"] }, (current) => (current ? syncPost(current) : current));
  queryClient.setQueriesData<FollowableProfileLike>({ queryKey: ["userProfile"] }, (current) => {
    if (!current) return current;
    const matchesProfile =
      current.id === author.id ||
      (normalizedUsername !== null && normalizeIdentifier(current.username) === normalizedUsername);
    return matchesProfile ? { ...current, isFollowing: nextFollowing } : current;
  });

  syncPostsInSessionCache(author, nextFollowing);
}
