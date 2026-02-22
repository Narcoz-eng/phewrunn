import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  className?: string;
  size?: "default" | "sm" | "lg" | "icon";
}

export function ThemeToggle({ className, size = "default" }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <Button
      variant="ghost"
      size={size}
      onClick={toggleTheme}
      className={cn(
        "relative group overflow-hidden transition-all duration-300",
        "hover:bg-primary/10 hover:text-primary",
        "border border-transparent hover:border-primary/20",
        className
      )}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      <div className="relative flex items-center gap-2">
        {/* Sun icon for light mode */}
        <Sun
          className={cn(
            "h-5 w-5 transition-all duration-300",
            theme === "dark"
              ? "rotate-0 scale-100 opacity-100"
              : "rotate-90 scale-0 opacity-0 absolute"
          )}
        />
        {/* Moon icon for dark mode */}
        <Moon
          className={cn(
            "h-5 w-5 transition-all duration-300",
            theme === "light"
              ? "rotate-0 scale-100 opacity-100"
              : "-rotate-90 scale-0 opacity-0 absolute"
          )}
        />
        {size !== "icon" && (
          <span className="font-medium text-sm hidden sm:inline">
            {theme === "dark" ? "Light" : "Dark"}
          </span>
        )}
      </div>

      {/* Subtle glow effect on hover */}
      <div
        className={cn(
          "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300",
          "bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5"
        )}
      />
    </Button>
  );
}

// Compact version for navigation bars
export function ThemeToggleCompact({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className={cn(
        "relative w-14 h-7 rounded-full p-1 transition-all duration-300",
        "bg-secondary border border-border",
        "hover:border-primary/30",
        className
      )}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {/* Track background */}
      <div
        className={cn(
          "absolute inset-0 rounded-full transition-all duration-300",
          theme === "light"
            ? "bg-gradient-to-r from-primary/10 to-accent/10"
            : "bg-gradient-to-r from-muted to-secondary"
        )}
      />

      {/* Sliding thumb */}
      <div
        className={cn(
          "relative z-10 w-5 h-5 rounded-full transition-all duration-300 flex items-center justify-center",
          "shadow-lg",
          theme === "dark"
            ? "translate-x-0 bg-secondary"
            : "translate-x-7 bg-card"
        )}
      >
        {theme === "dark" ? (
          <Moon className="h-3 w-3 text-primary" />
        ) : (
          <Sun className="h-3 w-3 text-primary" />
        )}
      </div>

      {/* Glow effect */}
      <div
        className={cn(
          "absolute rounded-full transition-all duration-500 blur-md",
          theme === "dark"
            ? "inset-0 bg-primary/10"
            : "inset-0 bg-primary/10"
        )}
      />
    </button>
  );
}
