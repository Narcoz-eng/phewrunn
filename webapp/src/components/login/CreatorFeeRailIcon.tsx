import { useId } from "react";

import { cn } from "@/lib/utils";

type CreatorFeeRailIconProps = {
  className?: string;
};

export function CreatorFeeRailIcon({ className }: CreatorFeeRailIconProps) {
  const gradientId = useId().replace(/:/g, "");
  const railGradientId = `${gradientId}-rail`;
  const glowGradientId = `${gradientId}-glow`;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient id={railGradientId} x1="4" y1="18" x2="20" y2="6" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#A9FF34" />
          <stop offset="0.56" stopColor="#76FF44" />
          <stop offset="1" stopColor="#41E8CF" />
        </linearGradient>
        <radialGradient id={glowGradientId} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(17.6 15.8) rotate(90) scale(4.8)">
          <stop offset="0" stopColor="#A9FF34" stopOpacity="0.28" />
          <stop offset="1" stopColor="#41E8CF" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="17.6" cy="15.8" r="4.8" fill={`url(#${glowGradientId})`} />

      <path
        d="M4.5 16.8L8.7 12.6H12.2L15.2 9.6"
        stroke={`url(#${railGradientId})`}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.2 9.5H9.8L12.3 7"
        stroke={`url(#${railGradientId})`}
        strokeWidth="1.9"
        strokeOpacity="0.42"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.3 7H19V11.7"
        stroke={`url(#${railGradientId})`}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="17.6"
        cy="15.8"
        r="2.15"
        fill="#0B1116"
        stroke={`url(#${railGradientId})`}
        strokeWidth="1.4"
      />
      <path
        d="M17.6 14.55V17.05M16.35 15.8H18.85"
        stroke={`url(#${railGradientId})`}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
