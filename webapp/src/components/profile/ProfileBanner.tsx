import { cn } from "@/lib/utils";

export interface BannerConfig {
  key: string;
  label: string;
  gradient: string;
  animated: boolean;
  requiredLevel: number;
  animationName?: string;
}

export const BANNER_CONFIGS: BannerConfig[] = [
  // Free (level 0+)
  {
    key: "void",
    label: "Void",
    gradient: "linear-gradient(135deg, #0a0a0f 0%, #12121e 50%, #0a0a0f 100%)",
    animated: false,
    requiredLevel: 0,
  },
  {
    key: "night",
    label: "Night",
    gradient: "linear-gradient(135deg, #0d1117 0%, #161b22 50%, #0d1117 100%)",
    animated: false,
    requiredLevel: 0,
  },
  // Level 5+
  {
    key: "nebula",
    label: "Nebula",
    gradient: "linear-gradient(270deg, #0d0d2b, #1a0533, #0d1f3c, #1a0533, #0d0d2b)",
    animated: true,
    requiredLevel: 5,
    animationName: "bannerShift",
  },
  {
    key: "ember",
    label: "Ember",
    gradient: "linear-gradient(270deg, #1a0500, #2d0a00, #1a0800, #3d1000, #1a0500)",
    animated: true,
    requiredLevel: 5,
    animationName: "bannerShift",
  },
  {
    key: "ocean",
    label: "Ocean",
    gradient: "linear-gradient(270deg, #001a1a, #003333, #001f2d, #003333, #001a1a)",
    animated: true,
    requiredLevel: 5,
    animationName: "bannerShift",
  },
  // Level 7+
  {
    key: "aurora",
    label: "Aurora",
    gradient: "linear-gradient(270deg, #001a0d, #0d2b1a, #001a1a, #0a2d0a, #001a0d)",
    animated: true,
    requiredLevel: 7,
    animationName: "bannerPulse",
  },
  {
    key: "inferno",
    label: "Inferno",
    gradient: "linear-gradient(270deg, #1a0000, #2d0500, #1a0800, #2d1000, #1a0000)",
    animated: true,
    requiredLevel: 7,
    animationName: "bannerPulse",
  },
  // Level 10
  {
    key: "apex",
    label: "Apex",
    gradient: "linear-gradient(270deg, #1a1400, #0d1f00, #001a0a, #1a1400, #0d0d1a, #1a1400)",
    animated: true,
    requiredLevel: 10,
    animationName: "bannerApex",
  },
];

// Keep backward compat with old gradient-N keys
export const BANNER_PRESETS: Record<string, string> = Object.fromEntries(
  BANNER_CONFIGS.map((b) => [b.key, b.gradient])
);

export function getBannerConfig(bannerImage: string | null | undefined): BannerConfig {
  if (!bannerImage) return BANNER_CONFIGS[0];
  // strip "gradient:" prefix if present
  const key = bannerImage.startsWith("gradient:") ? bannerImage.slice(9) : bannerImage;
  return BANNER_CONFIGS.find((b) => b.key === key) ?? BANNER_CONFIGS[0];
}

const BANNER_ANIMATION_CSS = `
@keyframes bannerShift {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes bannerPulse {
  0% { background-position: 0% 50%; opacity: 0.9; }
  33% { background-position: 60% 50%; opacity: 1; }
  66% { background-position: 100% 50%; opacity: 0.85; }
  100% { background-position: 0% 50%; opacity: 0.9; }
}
@keyframes bannerApex {
  0%   { background-position: 0% 50%; filter: hue-rotate(0deg); }
  50%  { background-position: 100% 50%; filter: hue-rotate(40deg); }
  100% { background-position: 0% 50%; filter: hue-rotate(0deg); }
}
`;

interface ProfileBannerProps {
  bannerImage?: string | null;
  className?: string;
}

export function ProfileBanner({ bannerImage, className }: ProfileBannerProps) {
  const config = getBannerConfig(bannerImage);

  const style: React.CSSProperties = config.animated
    ? {
        background: config.gradient,
        backgroundSize: "400% 400%",
        animation: `${config.animationName} ${config.key === "apex" ? "6s" : "8s"} ease infinite`,
      }
    : {
        background: config.gradient,
      };

  return (
    <>
      <style>{BANNER_ANIMATION_CSS}</style>
      <div className={cn("w-full h-36 md:h-44", className)} style={style} />
    </>
  );
}
