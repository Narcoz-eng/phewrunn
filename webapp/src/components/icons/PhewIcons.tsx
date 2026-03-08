import * as React from "react";

import { cn } from "@/lib/utils";

type PhewIconProps = React.SVGProps<SVGSVGElement>;

function PhewIcon({
  className,
  children,
  viewBox = "0 0 24 24",
  ...props
}: PhewIconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function PhewBellIcon(props: PhewIconProps) {
  return (
    <PhewIcon {...props}>
      <path d="M7.25 9.15c0-2.92 2.12-5.15 4.75-5.15s4.75 2.23 4.75 5.15v2.56c0 .8.28 1.58.78 2.2l1.02 1.25c.57.7.07 1.74-.84 1.74H6.29c-.91 0-1.41-1.04-.84-1.74l1.02-1.25c.5-.62.78-1.4.78-2.2V9.15Z" />
      <path d="M10.15 18.2c.32 1.16 1.04 1.8 1.85 1.8s1.53-.64 1.85-1.8" />
      <path d="M15.95 5.9 18 4.8" opacity=".55" />
    </PhewIcon>
  );
}

export function PhewTrophyIcon(props: PhewIconProps) {
  return (
    <PhewIcon {...props}>
      <path d="M8.2 4.5h7.6v2.35c0 2.44-1.7 4.54-4.06 5.04-.33.07-.67.07-1 0C8.4 11.39 6.7 9.29 6.7 6.85V4.5Z" />
      <path d="M8.2 6.1H5.7A1.7 1.7 0 0 0 4 7.8c0 2.1 1.62 3.8 3.62 3.8H8" />
      <path d="M15.8 6.1h2.5A1.7 1.7 0 0 1 20 7.8c0 2.1-1.62 3.8-3.62 3.8H16" />
      <path d="M12 12.1v3.15" />
      <path d="M9.15 19.5h5.7" />
      <path d="M10.1 15.25h3.8c.55 0 1 .45 1 1v.2c0 .55-.45 1-1 1h-3.8c-.55 0-1-.45-1-1v-.2c0-.55.45-1 1-1Z" />
    </PhewIcon>
  );
}

export function PhewLikeIcon(props: PhewIconProps) {
  return (
    <PhewIcon {...props}>
      <path d="M12 20.1c-1.76-1.8-6.85-4.9-6.85-9.15 0-2.1 1.56-3.8 3.61-3.8 1.5 0 2.48.77 3.24 1.94.76-1.17 1.74-1.94 3.24-1.94 2.05 0 3.61 1.7 3.61 3.8 0 4.25-5.09 7.35-6.85 9.15Z" />
      <path d="M5.4 12.25H3.5" opacity=".45" />
    </PhewIcon>
  );
}

export function PhewCommentIcon(props: PhewIconProps) {
  return (
    <PhewIcon {...props}>
      <path d="M6.15 6.15h11.7c1.02 0 1.85.83 1.85 1.85v6.35c0 1.02-.83 1.85-1.85 1.85h-6.4l-3.8 2.95c-.44.34-1.08.03-1.08-.53V16.2h-.42c-1.02 0-1.85-.83-1.85-1.85V8c0-1.02.83-1.85 1.85-1.85Z" />
      <path d="M8.4 10.4h7.2" />
      <path d="M8.4 13.2h4.6" opacity=".65" />
    </PhewIcon>
  );
}

export function PhewRepostIcon(props: PhewIconProps) {
  return (
    <PhewIcon {...props}>
      <path d="M7.1 7.15H18l-2.2-2.2" />
      <path d="M18 7.15 15.8 9.35" />
      <path d="M16.9 16.85H6l2.2 2.2" />
      <path d="M6 16.85 8.2 14.65" />
      <path d="M6 11.4V9.8c0-1.46 1.19-2.65 2.65-2.65H10" />
      <path d="M18 12.6v1.6c0 1.46-1.19 2.65-2.65 2.65H14" />
    </PhewIcon>
  );
}

export function PhewShareIcon(props: PhewIconProps) {
  return (
    <PhewIcon {...props}>
      <circle cx="6.1" cy="12.1" r="1.85" />
      <circle cx="16.95" cy="6.25" r="1.85" />
      <circle cx="16.95" cy="17.95" r="1.85" />
      <path d="m7.76 11.12 7.52-3.88" />
      <path d="m7.76 13.05 7.52 3.96" />
    </PhewIcon>
  );
}

export function PhewFollowIcon(props: PhewIconProps) {
  return (
    <PhewIcon {...props}>
      <path d="M9.35 11.15a2.95 2.95 0 1 0 0-5.9 2.95 2.95 0 0 0 0 5.9Z" />
      <path d="M4.75 18.8c.5-2.5 2.45-4 4.6-4s4.1 1.5 4.6 4" />
      <path d="M18.15 8.15v5.2" />
      <path d="M15.55 10.75h5.2" />
    </PhewIcon>
  );
}

export function PhewTradeIcon(props: PhewIconProps) {
  return (
    <PhewIcon {...props}>
      <path d="M13.2 3.95 6.8 12.2h4.15l-.95 7.85 6.2-8.1h-4.05l1.05-8Z" />
      <path d="M16.85 5.25h2.4" opacity=".45" />
    </PhewIcon>
  );
}

export function PhewChartIcon(props: PhewIconProps) {
  return (
    <PhewIcon {...props}>
      <rect x="5.35" y="5.15" width="13.3" height="13.7" rx="2.2" />
      <path d="m7.8 14.75 3.05-3.2 2.45 1.95 3.2-4.2" />
      <path d="M15.15 9.3h1.35V10.7" />
    </PhewIcon>
  );
}

export function PhewSendIcon(props: PhewIconProps) {
  return (
    <PhewIcon {...props}>
      <path d="M4.4 11.55 18.95 5.1c.63-.28 1.26.36.96.98l-6.3 14.43c-.3.69-1.3.62-1.5-.11l-1.55-5.55-5.43-1.53c-.74-.21-.79-1.23-.07-1.55Z" />
      <path d="m10.95 14.85 8.02-8.02" />
    </PhewIcon>
  );
}

export function PhewEditIcon(props: PhewIconProps) {
  return (
    <PhewIcon {...props}>
      <path d="M5.35 18.65 6 15.2l8.55-8.55a1.85 1.85 0 0 1 2.62 0l.18.18a1.85 1.85 0 0 1 0 2.62L8.8 18l-3.45.65Z" />
      <path d="m13.75 7.45 2.8 2.8" />
      <path d="M4.9 19.1h14.2" opacity=".5" />
    </PhewIcon>
  );
}

export function PhewCopyIcon(props: PhewIconProps) {
  return (
    <PhewIcon {...props}>
      <rect x="8.2" y="6.2" width="9.1" height="11.2" rx="2" />
      <path d="M6.4 14.8H5.6A1.9 1.9 0 0 1 3.7 12.9V5.6a1.9 1.9 0 0 1 1.9-1.9h6.9a1.9 1.9 0 0 1 1.9 1.9v.8" />
    </PhewIcon>
  );
}
