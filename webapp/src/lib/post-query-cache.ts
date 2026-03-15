import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { Post } from "@/types";

type FeedPageLike = {
  items: Post[];
};

type TokenPageLike = {
  recentCalls?: Post[];
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

export function syncPostsIntoQueryCache(queryClient: QueryClient, posts: Post[] | null | undefined): void {
  for (const post of posts ?? []) {
    if (!post?.id) continue;
    queryClient.setQueryData<Post>(["post", post.id], (existing) => pickPreferredPost(existing, post));
  }
}
