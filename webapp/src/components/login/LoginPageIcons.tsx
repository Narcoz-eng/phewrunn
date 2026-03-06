import type { ComponentType, SVGProps } from "react";

import { cn } from "@/lib/utils";

type LoginPageIconProps = SVGProps<SVGSVGElement>;

function glyphClassName(className?: string) {
  return cn("shrink-0", className);
}

export type LoginPageGlyph = ComponentType<{ className?: string }>;

export function SignalBurstIcon({ className, ...props }: LoginPageIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={glyphClassName(className)} {...props}>
      <path
        d="M12 4.8L13.9 9.2L18.4 11.1L13.9 13L12 17.4L10.1 13L5.6 11.1L10.1 9.2L12 4.8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="18.6" cy="6.2" r="1.15" fill="currentColor" fillOpacity="0.4" />
      <circle cx="6.1" cy="17.7" r="1.15" fill="currentColor" fillOpacity="0.24" />
    </svg>
  );
}

export function InboxRouteIcon({ className, ...props }: LoginPageIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={glyphClassName(className)} {...props}>
      <path
        d="M4.75 8.25L12 13.5L19.25 8.25"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.25 6H17.75C18.7165 6 19.5 6.7835 19.5 7.75V16.25C19.5 17.2165 18.7165 18 17.75 18H6.25C5.2835 18 4.5 17.2165 4.5 16.25V7.75C4.5 6.7835 5.2835 6 6.25 6Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15.75 5.25L18.75 5.25L18.75 8.25"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.38"
      />
    </svg>
  );
}

export function RouteArrowIcon({ className, ...props }: LoginPageIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={glyphClassName(className)} {...props}>
      <path
        d="M5 12H18.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M13.9 7.4L18.5 12L13.9 16.6"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.2 8.6H9.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.35"
      />
      <path
        d="M5.2 15.4H11.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.25"
      />
    </svg>
  );
}

export function ProofShieldIcon({ className, ...props }: LoginPageIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={glyphClassName(className)} {...props}>
      <path
        d="M12 4.75L18 7.35V11.55C18 15.2 15.52 18.48 12 19.25C8.48 18.48 6 15.2 6 11.55V7.35L12 4.75Z"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.35 12.15L11.2 14L14.9 10.3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TimingWindowIcon({ className, ...props }: LoginPageIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={glyphClassName(className)} {...props}>
      <path
        d="M12 5.25C15.7279 5.25 18.75 8.27208 18.75 12C18.75 15.7279 15.7279 18.75 12 18.75C8.27208 18.75 5.25 15.7279 5.25 12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M12 8.3V12L15 13.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 7.5H9.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.38"
      />
    </svg>
  );
}

export function SignalTargetIcon({ className, ...props }: LoginPageIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={glyphClassName(className)} {...props}>
      <circle cx="12" cy="12" r="6.4" stroke="currentColor" strokeWidth="1.8" opacity="0.45" />
      <circle cx="12" cy="12" r="2.3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M15.7 8.3L19 5M16.8 5H19V7.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.9 9.1L13.25 10.75"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function FlowRouteIcon({ className, ...props }: LoginPageIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={glyphClassName(className)} {...props}>
      <path
        d="M5.25 16.2L9.1 12.35L12.15 14.55L18.75 7.95"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.7 7.95H18.75V12"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="5.25" cy="16.2" r="1.3" fill="currentColor" fillOpacity="0.3" />
      <circle cx="9.1" cy="12.35" r="1.3" fill="currentColor" fillOpacity="0.3" />
      <circle cx="12.15" cy="14.55" r="1.3" fill="currentColor" fillOpacity="0.3" />
    </svg>
  );
}

export function CommunityTrustIcon({ className, ...props }: LoginPageIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={glyphClassName(className)} {...props}>
      <circle cx="9" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="15.3" cy="8.7" r="2.15" stroke="currentColor" strokeWidth="1.55" opacity="0.6" />
      <path
        d="M5.8 17.8C6.5 15.35 8.45 14 11 14C13.55 14 15.55 15.35 16.2 17.8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M15.4 14.25C17.1 14.45 18.45 15.35 19.05 17.05"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path
        d="M10.2 5.55L13.35 5.55"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        opacity="0.38"
      />
    </svg>
  );
}

export function OutcomeLiftIcon({ className, ...props }: LoginPageIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={glyphClassName(className)} {...props}>
      <path
        d="M5.4 16.8L10.15 12.05L13 14.9L18.7 9.2"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.8 9.2H18.7V13.1"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M5.35 8.4V16.8H13.75" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.28" />
    </svg>
  );
}

export function RecoveryWindowIcon({ className, ...props }: LoginPageIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={glyphClassName(className)} {...props}>
      <path
        d="M12 4.9L17.4 7.2V10.95C17.4 14.15 15.25 17.02 12 17.75C8.75 17.02 6.6 14.15 6.6 10.95V7.2L12 4.9Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 10.6C9.92 9.52 11 8.8 12.2 8.8C13.78 8.8 15.05 10.08 15.05 11.65C15.05 13.23 13.78 14.5 12.2 14.5C11.1 14.5 10.14 13.88 9.65 12.98"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M8.65 10.1V12.55H11.1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ConsistencyGridIcon({ className, ...props }: LoginPageIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={glyphClassName(className)} {...props}>
      <path
        d="M5.2 15.4L8.1 12.5L10.5 14.9L14.2 11.2L16.7 13.7L18.8 11.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="5.1" y="7" width="2.3" height="2.3" rx="0.6" fill="currentColor" fillOpacity="0.22" />
      <rect x="10.85" y="7" width="2.3" height="2.3" rx="0.6" fill="currentColor" fillOpacity="0.35" />
      <rect x="16.6" y="7" width="2.3" height="2.3" rx="0.6" fill="currentColor" fillOpacity="0.5" />
    </svg>
  );
}

export function PenaltyMarkIcon({ className, ...props }: LoginPageIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={glyphClassName(className)} {...props}>
      <path
        d="M6 7.2H18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.3"
      />
      <path
        d="M6 9.2L10.5 13.7L13.25 10.95L18 15.7"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.25 15.7H18V11.95"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="9.2" r="1.25" fill="currentColor" fillOpacity="0.26" />
    </svg>
  );
}

export function SignalCompoundIcon({ className, ...props }: LoginPageIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={glyphClassName(className)} {...props}>
      <path
        d="M6 15.6C7.15 12.25 9.55 10.55 12.35 10.55C15.05 10.55 17.2 11.85 18.25 14.55"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M6.75 18.1C8.05 14.2 10.8 12.1 14.05 12.1C16.1 12.1 17.95 12.95 19.25 14.6"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        opacity="0.48"
      />
      <circle cx="12.1" cy="8.2" r="2.2" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

export function LevelTierIcon({ className, ...props }: LoginPageIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={glyphClassName(className)} {...props}>
      <path d="M6 17.75H18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.25 13.8H15.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.7" />
      <path d="M10.4 9.85H13.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.42" />
      <path
        d="M12 5.3L12.85 7.1L14.8 7.35L13.35 8.7L13.7 10.6L12 9.65L10.3 10.6L10.65 8.7L9.2 7.35L11.15 7.1L12 5.3Z"
        fill="currentColor"
        fillOpacity="0.88"
      />
    </svg>
  );
}
