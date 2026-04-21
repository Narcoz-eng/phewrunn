/* eslint-disable react-refresh/only-export-components */
import { cn } from "@/lib/utils";

export interface BannerConfig {
  key: string;
  label: string;
  gradient: string;
  animated: boolean;
  requiredLevel: number;
  animationName?: string;
  duration?: number;
  glowColor?: string;
  overlayType?: "dots" | "shimmer" | "wave" | "grid" | "scan";
  glowPosition?: "bottom" | "top" | "both";
}

export const BANNER_CONFIGS: BannerConfig[] = [
  // ── Free (Level 0) ── flat, no life, no glow ──────────────────────────────
  {
    key: "void",
    label: "Void",
    gradient: "#040406",
    animated: false,
    requiredLevel: 0,
  },
  {
    key: "night",
    label: "Night",
    gradient: "linear-gradient(135deg, #07090f 0%, #0c1120 60%, #07090f 100%)",
    animated: false,
    requiredLevel: 0,
  },

  // ── Level 3 (Credible) ── subtle metallic depth, still quiet ──────────────
  {
    key: "steel",
    label: "Steel",
    gradient:
      "linear-gradient(135deg, #0b1220 0%, #162035 35%, #1d2b42 55%, #162035 80%, #0b1220 100%)",
    animated: false,
    requiredLevel: 3,
    overlayType: "grid",
  },

  // ── Level 5 (Veteran) ── rich color, animated, first real glow ────────────
  {
    key: "nebula",
    label: "Nebula",
    gradient:
      "linear-gradient(270deg, #080220, #1c0648, #0a1042, #1c0648, #080220)",
    animated: true,
    requiredLevel: 5,
    animationName: "bannerShift",
    duration: 8,
    glowColor: "rgba(110, 30, 255, 0.45)",
    overlayType: "dots",
    glowPosition: "bottom",
  },
  {
    key: "ember",
    label: "Ember",
    gradient:
      "linear-gradient(270deg, #180500, #4a1000, #220800, #4a1000, #180500)",
    animated: true,
    requiredLevel: 5,
    animationName: "bannerShift",
    duration: 8,
    glowColor: "rgba(255, 65, 0, 0.45)",
    glowPosition: "bottom",
  },
  {
    key: "ocean",
    label: "Ocean",
    gradient:
      "linear-gradient(270deg, #000b18, #001c3a, #000e24, #001c3a, #000b18)",
    animated: true,
    requiredLevel: 5,
    animationName: "bannerShift",
    duration: 8,
    glowColor: "rgba(0, 95, 210, 0.42)",
    overlayType: "scan",
    glowPosition: "bottom",
  },

  // ── Level 7 (High Veteran) ── vivid, pulsing, unmistakably premium ─────────
  {
    key: "aurora",
    label: "Aurora",
    gradient:
      "linear-gradient(270deg, #000d06, #003818, #001026, #003818, #000d06)",
    animated: true,
    requiredLevel: 7,
    animationName: "bannerPulse",
    duration: 5,
    glowColor: "rgba(0, 235, 90, 0.65)",
    overlayType: "wave",
    glowPosition: "top",
  },
  {
    key: "solar",
    label: "Solar",
    gradient:
      "linear-gradient(270deg, #0e0700, #4c2700, #180d00, #4c2700, #0e0700)",
    animated: true,
    requiredLevel: 7,
    animationName: "bannerPulse",
    duration: 5,
    glowColor: "rgba(255, 158, 0, 0.65)",
    overlayType: "wave",
    glowPosition: "both",
  },
  {
    key: "inferno",
    label: "Inferno",
    gradient:
      "linear-gradient(270deg, #0e0000, #480000, #1a0000, #480000, #0e0000)",
    animated: true,
    requiredLevel: 7,
    animationName: "bannerPulse",
    duration: 5,
    glowColor: "rgba(255, 18, 18, 0.65)",
    overlayType: "wave",
    glowPosition: "both",
  },

  // ── Level 10 (Apex / Elite) ── blazing gold prismatic, unmissable ──────────
  {
    key: "apex",
    label: "Apex",
    gradient:
      "linear-gradient(270deg, #1a1000, #5c3300, #001a12, #1a1000, #0e0038, #1a1000)",
    animated: true,
    requiredLevel: 10,
    animationName: "bannerApex",
    duration: 5,
    glowColor: "rgba(255, 185, 10, 0.88)",
    overlayType: "shimmer",
    glowPosition: "both",
  },
];

export const BANNER_PRESETS: Record<string, string> = Object.fromEntries(
  BANNER_CONFIGS.map((b) => [b.key, b.gradient])
);

export function getBannerConfig(
  bannerImage: string | null | undefined
): BannerConfig {
  if (!bannerImage) return BANNER_CONFIGS[0];
  const key = bannerImage.startsWith("gradient:")
    ? bannerImage.slice(9)
    : bannerImage;
  return BANNER_CONFIGS.find((b) => b.key === key) ?? BANNER_CONFIGS[0];
}

const BANNER_ANIMATION_CSS = `
@keyframes bannerShift {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes bannerPulse {
  0%   { background-position: 0% 50%;   opacity: 0.88; }
  33%  { background-position: 60% 50%;  opacity: 1; }
  66%  { background-position: 100% 50%; opacity: 0.82; }
  100% { background-position: 0% 50%;   opacity: 0.88; }
}
@keyframes bannerApex {
  0%   { background-position: 0% 50%;   filter: hue-rotate(0deg)   brightness(1); }
  25%  { background-position: 50% 50%;  filter: hue-rotate(20deg)  brightness(1.15); }
  50%  { background-position: 100% 50%; filter: hue-rotate(42deg)  brightness(1.05); }
  75%  { background-position: 50% 50%;  filter: hue-rotate(18deg)  brightness(1.2); }
  100% { background-position: 0% 50%;   filter: hue-rotate(0deg)   brightness(1); }
}
@keyframes apexShimmer {
  0%   { background-position: 220% 0; }
  100% { background-position: -220% 0; }
}
@keyframes auroraWave {
  0%   { opacity: 0.55; transform: scaleX(1)    skewX(0deg); }
  40%  { opacity: 1;    transform: scaleX(1.04) skewX(-1deg); }
  80%  { opacity: 0.7;  transform: scaleX(0.97) skewX(1deg); }
  100% { opacity: 0.55; transform: scaleX(1)    skewX(0deg); }
}
@keyframes scanScroll {
  0%   { background-position: 0 0; }
  100% { background-position: 0 60px; }
}
`;

interface ProfileBannerProps {
  bannerImage?: string | null;
  className?: string;
}

export function ProfileBanner({ bannerImage, className }: ProfileBannerProps) {
  const config = getBannerConfig(bannerImage);

  const baseStyle: React.CSSProperties = config.animated
    ? {
        background: config.gradient,
        backgroundSize: "400% 400%",
        animation: `${config.animationName} ${config.duration ?? 8}s ease infinite`,
      }
    : { background: config.gradient };

  return (
    <>
      <style>{BANNER_ANIMATION_CSS}</style>
      <div
        className={cn("w-full h-36 md:h-44 relative overflow-hidden", className)}
        style={baseStyle}
      >
        {/* ── Grid overlay (Steel) ── */}
        {config.overlayType === "grid" && (
          <div
            className="absolute inset-0 pointer-events-none opacity-[0.07]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.9) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.9) 1px, transparent 1px)",
              backgroundSize: "44px 44px",
            }}
          />
        )}

        {/* ── Star dots overlay (Nebula) ── */}
        {config.overlayType === "dots" && (
          <div
            className="absolute inset-0 pointer-events-none opacity-[0.18]"
            style={{
              backgroundImage:
                "radial-gradient(circle, rgba(255,255,255,0.85) 1px, transparent 1px)",
              backgroundSize: "28px 28px",
            }}
          />
        )}

        {/* ── Horizontal scanlines (Ocean) ── */}
        {config.overlayType === "scan" && (
          <div
            className="absolute inset-0 pointer-events-none opacity-[0.06]"
            style={{
              backgroundImage:
                "repeating-linear-gradient(0deg, rgba(255,255,255,0.7) 0px, rgba(255,255,255,0.7) 1px, transparent 1px, transparent 4px)",
              animation: "scanScroll 2s linear infinite",
            }}
          />
        )}

        {/* ── Aurora wave bands (level 7) ── */}
        {config.overlayType === "wave" && config.glowColor && (
          <>
            <div
              className="absolute inset-x-0 pointer-events-none"
              style={{
                top: "10%",
                height: "30%",
                background: `linear-gradient(to bottom, ${config.glowColor.replace(/[\d.]+\)$/, "0.18)")}, transparent)`,
                animation: "auroraWave 4.5s ease-in-out infinite",
              }}
            />
            <div
              className="absolute inset-x-0 pointer-events-none"
              style={{
                top: "30%",
                height: "25%",
                background: `linear-gradient(to bottom, transparent, ${config.glowColor.replace(/[\d.]+\)$/, "0.12)")}, transparent)`,
                animation: "auroraWave 5.5s ease-in-out infinite reverse",
              }}
            />
          </>
        )}

        {/* ── Gold shimmer sweep (Apex) ── */}
        {config.overlayType === "shimmer" && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "linear-gradient(105deg, transparent 35%, rgba(255,215,60,0.22) 47%, rgba(255,248,180,0.35) 50%, rgba(255,215,60,0.22) 53%, transparent 65%)",
              backgroundSize: "350% 100%",
              animation: "apexShimmer 2.8s linear infinite",
            }}
          />
        )}

        {/* ── Bottom glow ── */}
        {config.glowColor &&
          (config.glowPosition === "bottom" ||
            config.glowPosition === "both") && (
            <div
              className="absolute bottom-0 inset-x-0 h-3/5 pointer-events-none"
              style={{
                background: `linear-gradient(to top, ${config.glowColor} 0%, transparent 100%)`,
              }}
            />
          )}

        {/* ── Top glow ── */}
        {config.glowColor &&
          (config.glowPosition === "top" ||
            config.glowPosition === "both") && (
            <div
              className="absolute top-0 inset-x-0 h-2/5 pointer-events-none"
              style={{
                background: `linear-gradient(to bottom, ${config.glowColor} 0%, transparent 100%)`,
              }}
            />
          )}

        {/* ── Bottom border glow line (level 5+) ── */}
        {config.glowColor && (
          <div
            className="absolute bottom-0 inset-x-0 h-px pointer-events-none"
            style={{ background: config.glowColor.replace(/[\d.]+\)$/, "0.9)") }}
          />
        )}
      </div>
    </>
  );
}
