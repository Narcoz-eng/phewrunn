import type { Post } from "@/types";

export function applyPostPollVote(post: Post, optionId: string): Post {
  if (!post.poll) return post;

  const previousVote = post.poll.viewerOptionId;
  if (previousVote === optionId) return post;

  const options = post.poll.options.map((option) => {
    let votes = option.votes;
    if (option.id === previousVote) votes = Math.max(0, votes - 1);
    if (option.id === optionId) votes += 1;
    return { ...option, votes };
  });
  const totalVotes = options.reduce((sum, option) => sum + option.votes, 0);

  return {
    ...post,
    poll: {
      totalVotes,
      viewerOptionId: optionId,
      options: options.map((option) => ({
        ...option,
        percentage: totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0,
      })),
    },
  };
}
