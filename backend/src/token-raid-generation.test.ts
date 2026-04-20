import { describe, expect, test } from "bun:test";
import {
  TokenRaidGenerationResultSchema,
  safeGenerateTokenRaidOptions,
} from "./services/token-raid-generation.js";

describe("token raid generation", () => {
  const baseInput = {
    token: {
      id: "token_1",
      symbol: "PHEW",
      name: "Just A Phew",
      chainType: "solana",
      holderCount: 1842,
      sentimentScore: 71,
      confidenceScore: 76,
      hotAlphaScore: 79,
      earlyRunnerScore: 68,
      highConvictionScore: 74,
    },
    objective: "Make $PHEW feel like the funniest room on the timeline without sounding desperate.",
    profile: {
      headline: "$PHEW is sarcastic, online, and weirdly documented.",
      xCashtag: "$PHEW",
      voiceHints: ["dry confidence", "receipts over slogans", "group-chat chaos with timing"],
      insideJokes: ["the chart keeps pretending to be innocent", "receipts age better than cope"],
      preferredTemplateIds: ["group-chat", "chart-rat"],
    },
    recentThreads: [
      { title: "late night setup", content: "liquidity woke up and the room got smug fast" },
      { title: "desk noise", content: "everyone is joking but also quietly collecting receipts" },
    ],
    recentRaidHistory: [
      {
        objective: "Old raid",
        memeOptions: [
          {
            id: "meme-old",
            templateId: "chart-rat",
            title: "Receipt Rat",
            angle: "Smug chart-room flex",
            topText: "$PHEW room when the chart fakes weakness",
            bottomText: "and the receipts start flying",
          },
        ],
        copyOptions: [
          {
            id: "copy-old",
            style: "deadpan-flex",
            label: "Deadpan flex",
            angle: "Calm, smug, and clipped",
            text: "$PHEW has receipts again.",
          },
        ],
      },
    ],
  } as const;

  test("always returns exactly three meme and copy options with valid schema", () => {
    const result = safeGenerateTokenRaidOptions({
      ...baseInput,
      generationSalt: "seed-a",
    });

    expect(TokenRaidGenerationResultSchema.safeParse(result).success).toBeTrue();
    expect(result.memeOptions).toHaveLength(3);
    expect(result.copyOptions).toHaveLength(3);
  });

  test("keeps strong variation inside one generation", () => {
    const result = safeGenerateTokenRaidOptions({
      ...baseInput,
      generationSalt: "seed-b",
    });

    expect(new Set(result.memeOptions.map((option) => option.templateId)).size).toBe(3);
    expect(new Set(result.copyOptions.map((option) => option.style)).size).toBe(3);
    expect(new Set(result.copyOptions.map((option) => option.text)).size).toBe(3);
  });

  test("changes outputs across regenerations while preserving quality constraints", () => {
    const first = safeGenerateTokenRaidOptions({
      ...baseInput,
      generationSalt: "regen-1",
    });
    const second = safeGenerateTokenRaidOptions({
      ...baseInput,
      generationSalt: "regen-2",
    });

    expect(first.copyOptions.map((option) => option.text).join("\n")).not.toBe(
      second.copyOptions.map((option) => option.text).join("\n"),
    );
    expect(first.memeOptions.map((option) => `${option.templateId}:${option.topText}`).join("\n")).not.toBe(
      second.memeOptions.map((option) => `${option.templateId}:${option.topText}`).join("\n"),
    );
    expect(second.copyOptions.every((option) => option.text.length <= 280)).toBeTrue();
  });
});
