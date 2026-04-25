import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, BarChart3, FileText, Image, Loader2, Lock, MessageSquare, RadioTower, Vote } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getAvatarUrl, LIQUIDATION_LEVEL, type Post, type User } from "@/types";
import { toast } from "sonner";

type ComposerMode = NonNullable<Post["postType"]>;
type ComposerIntent = "image" | "chart" | "long" | "short" | "raid" | "poll" | "discussion" | "news";

interface CreatePostProps {
  user: User | null;
  onSubmit: (content: string, postType: ComposerMode, options?: { pollOptions?: string[] }) => Promise<void>;
  isSubmitting: boolean;
  isAuthPending?: boolean;
  initialMode?: ComposerMode | null;
}

const MIN_CHARS = 10;
const MAX_CHARS = 400;

const INTENTS: Array<{
  id: ComposerIntent;
  label: string;
  icon: typeof Image;
  postType: ComposerMode | null;
  disabled?: boolean;
  unavailableReason?: string;
}> = [
  { id: "image", label: "Image", icon: Image, postType: null, disabled: true, unavailableReason: "Image upload is not enabled for feed posts yet." },
  { id: "chart", label: "Chart", icon: BarChart3, postType: "chart" },
  { id: "long", label: "Long", icon: ArrowUpRight, postType: "alpha" },
  { id: "short", label: "Short", icon: ArrowDownRight, postType: "alpha" },
  { id: "raid", label: "Raid", icon: RadioTower, postType: "raid" },
  { id: "poll", label: "Poll", icon: Vote, postType: "poll" },
  { id: "discussion", label: "Discussion", icon: MessageSquare, postType: "discussion" },
  { id: "news", label: "News", icon: FileText, postType: "news" },
];

function modeToIntent(mode: ComposerMode | null | undefined): ComposerIntent {
  if (mode === "chart") return "chart";
  if (mode === "poll") return "poll";
  if (mode === "raid") return "raid";
  if (mode === "discussion") return "discussion";
  if (mode === "news") return "news";
  return "long";
}

function placeholderFor(intent: ComposerIntent): string {
  if (intent === "chart") return "Share the setup, timeframe, invalidation, and token address if available...";
  if (intent === "short") return "What is the short thesis? Add invalidation and token address if available...";
  if (intent === "raid") return "Share raid target, room context, and what action traders should take...";
  if (intent === "poll") return "Ask the room a clean market question...";
  if (intent === "discussion") return "Start a thread for traders, communities, or token context...";
  if (intent === "news") return "Headline, source, and why it matters...";
  return "What's your alpha today?";
}

function postTypeForIntent(intent: ComposerIntent): ComposerMode {
  return INTENTS.find((item) => item.id === intent)?.postType ?? "alpha";
}

function normalizeContentForIntent(content: string, intent: ComposerIntent): string {
  const trimmed = content.trim();
  if (intent === "long" && !/\blong\b/i.test(trimmed)) return `LONG ${trimmed}`;
  if (intent === "short" && !/\bshort\b/i.test(trimmed)) return `SHORT ${trimmed}`;
  return trimmed;
}

export function CreatePost({ user, onSubmit, isSubmitting, isAuthPending = false, initialMode = null }: CreatePostProps) {
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [content, setContent] = useState("");
  const [intent, setIntent] = useState<ComposerIntent>(() => modeToIntent(initialMode));
  const [pollOptions, setPollOptions] = useState(["", ""]);

  const isLiquidated = user !== null && user.level <= LIQUIDATION_LEVEL;
  const selected = INTENTS.find((item) => item.id === intent) ?? INTENTS[2];
  const postType = postTypeForIntent(intent);
  const disabled = isSubmitting || isLiquidated || isAuthPending;
  const charCount = content.length;
  const canSubmit = !disabled && charCount >= MIN_CHARS && charCount <= MAX_CHARS;

  useEffect(() => {
    if (!initialMode) return;
    setIntent(modeToIntent(initialMode));
    textareaRef.current?.focus();
  }, [initialMode]);

  const cleanPollOptions = useMemo(
    () => pollOptions.map((option) => option.trim()).filter(Boolean),
    [pollOptions]
  );

  async function handleSubmit() {
    if (isLiquidated) {
      toast.error("Account liquidated. Posting is locked until reputation improves.");
      return;
    }
    if (!canSubmit) {
      toast.error(charCount < MIN_CHARS ? `Post must be at least ${MIN_CHARS} characters` : `Post must be under ${MAX_CHARS} characters`);
      return;
    }
    if (postType === "poll" && cleanPollOptions.length < 2) {
      toast.error("Poll posts need at least two options");
      return;
    }

    await onSubmit(
      normalizeContentForIntent(content, intent),
      postType,
      postType === "poll" ? { pollOptions: cleanPollOptions } : undefined
    );
    setContent("");
    setPollOptions(["", ""]);
    setIntent("long");
  }

  if (!user) return null;

  return (
    <section className="rounded-[16px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,13,19,0.97),rgba(4,8,12,0.99))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      {isLiquidated ? (
        <div className="mb-3 rounded-[12px] border border-rose-400/24 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
          Posting disabled because this account is below the reputation threshold.
        </div>
      ) : null}
      <div className="flex gap-3">
        <button type="button" onClick={() => navigate("/profile")} className="shrink-0">
          <Avatar className="h-11 w-11 border border-lime-300/18">
            <AvatarImage src={getAvatarUrl(user.id, user.image)} />
            <AvatarFallback className="bg-white/[0.06] text-white/70">{user.name?.charAt(0) || "?"}</AvatarFallback>
          </Avatar>
        </button>

        <div className="min-w-0 flex-1">
          <textarea
            ref={textareaRef}
            rows={2}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            disabled={disabled}
            placeholder={isAuthPending ? "Signing you in..." : placeholderFor(intent)}
            className="min-h-[50px] w-full resize-none rounded-[12px] border border-white/8 bg-black/20 px-4 py-3 text-sm leading-5 text-white outline-none placeholder:text-white/35 focus:border-lime-300/24 focus:ring-2 focus:ring-lime-300/10 disabled:opacity-50"
          />

          {intent === "poll" ? (
            <div className="mt-2 rounded-[12px] border border-white/8 bg-white/[0.025] p-2">
              <div className="grid gap-2">
                {pollOptions.map((option, index) => (
                  <Input
                    key={index}
                    value={option}
                    onChange={(event) =>
                      setPollOptions((current) => current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))
                    }
                    placeholder={`Poll option ${index + 1}`}
                    className="h-9 rounded-[10px] border-white/8 bg-black/20 text-sm text-white placeholder:text-white/30"
                  />
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                disabled={pollOptions.length >= 6}
                onClick={() => setPollOptions((current) => [...current, ""])}
                className="mt-2 h-8 rounded-[10px] px-3 text-xs text-white/62"
              >
                Add option
              </Button>
            </div>
          ) : null}

          <div className="mt-2 flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {INTENTS.map((item) => {
                const Icon = item.icon;
                const active = item.id === intent;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={item.disabled}
                    title={item.unavailableReason}
                    onClick={() => {
                      if (item.disabled) {
                        toast.info(item.unavailableReason);
                        return;
                      }
                      setIntent(item.id);
                    }}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-[9px] border px-2.5 text-xs font-semibold transition",
                      active
                        ? "border-lime-300/35 bg-lime-300/[0.13] text-lime-100"
                        : "border-white/8 bg-white/[0.025] text-white/56 hover:bg-white/[0.055] hover:text-white/78",
                      item.disabled && "cursor-not-allowed opacity-45"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className={cn("text-xs", charCount > MAX_CHARS ? "text-rose-300" : charCount >= MIN_CHARS ? "text-white/54" : "text-white/34")}>
                {charCount}/{MAX_CHARS} · {selected.label}
              </span>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit || isSubmitting}
                className="h-9 rounded-[10px] bg-[linear-gradient(135deg,#a9ff34,#12d7aa)] px-5 text-sm font-bold text-slate-950 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLiquidated ? <Lock className="mr-2 h-4 w-4" /> : isSubmitting || isAuthPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Post
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
