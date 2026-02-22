interface VerifiedBadgeProps {
  size?: "sm" | "md";
  className?: string;
}

export function VerifiedBadge({ size = "sm", className }: VerifiedBadgeProps) {
  const dimension = size === "sm" ? 14 : 18;

  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}
      title="Verified"
      aria-label="Verified"
    >
      <svg
        width={dimension}
        height={dimension}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="12" fill="#1D9BF0" />
        <path
          d="M9.5 16.5L5.5 12.5L6.91 11.09L9.5 13.67L17.09 6.08L18.5 7.5L9.5 16.5Z"
          fill="white"
        />
      </svg>
    </span>
  );
}
