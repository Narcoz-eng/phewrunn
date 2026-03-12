import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { Post } from "@/types";

type FeedPageLike = {
  items: Post[];
};

type TokenPageLike = {
  recentCalls?: Post[];
};

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

export function collectCachedPosts(queryClient: QueryClient): Post[] {
  const posts: Post[] = [];
  const seenIds = new Set<string>();

  const feedEntries = queryClient.getQueriesData<InfiniteData<FeedPageLike>>({
    queryKey: ["posts"],
  });
  for (const [, data] of feedEntries) {
    for (const page of data?.pages ?? []) {
      dedupePushPostArray(posts, seenIds, page.items);
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
      dedupePushPostArray(posts, seenIds, data);
    }
  }

  const tokenPageEntries = queryClient.getQueriesData<TokenPageLike>({
    queryKey: ["token-page"],
  });
  for (const [, data] of tokenPageEntries) {
    dedupePushPostArray(posts, seenIds, data?.recentCalls);
  }

  const detailEntries = queryClient.getQueriesData<Post>({
    queryKey: ["post"],
  });
  for (const [, data] of detailEntries) {
    dedupePushPost(posts, seenIds, data);
  }

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
