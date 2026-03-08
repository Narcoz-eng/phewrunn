import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  isLoading?: boolean;
  className?: string;
}

export function SearchBar({ value, onChange, isLoading, className }: SearchBarProps) {
  const [localValue, setLocalValue] = useState(value);

  // Sync with external value
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Debounce the onChange callback
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localValue !== value) {
        onChange(localValue);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [localValue, onChange, value]);

  const handleClear = useCallback(() => {
    setLocalValue("");
    onChange("");
  }, [onChange]);

  return (
    <div className={cn("relative mb-5", className)}>
      <div className="relative">
        {/* Search Icon */}
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
          {isLoading ? (
            <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
          ) : (
            <Search className="h-4 w-4 text-muted-foreground" />
          )}
        </div>

        {/* Input */}
        <Input
          type="text"
          placeholder="Search tokens, users, or keywords..."
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          className={cn(
            "h-12 rounded-[22px] pl-11 pr-11 text-sm",
            "border-border/70 bg-[linear-gradient(180deg,hsl(0_0%_100%/0.92),hsl(38_32%_94%/0.9))]",
            "shadow-[0_20px_44px_-34px_hsl(var(--foreground)/0.16)]",
            "focus:border-primary/45",
            "placeholder:text-muted-foreground/60",
            "dark:bg-[linear-gradient(180deg,rgba(13,15,21,0.92),rgba(8,10,14,0.96))] dark:shadow-none"
          )}
        />

        {/* Clear Button */}
        {localValue && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1.5 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full text-muted-foreground hover:text-foreground"
            onClick={handleClear}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Search hint */}
      {localValue && localValue.length < 3 && (
        <p className="mt-1 text-xs text-muted-foreground">
          Type at least 3 characters to search
        </p>
      )}
    </div>
  );
}
