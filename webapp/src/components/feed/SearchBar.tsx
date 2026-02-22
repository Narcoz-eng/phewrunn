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
    <div className={cn("relative mb-4", className)}>
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
            "pl-10 pr-10 h-11",
            "bg-secondary/50 border-border/50",
            "focus:bg-background focus:border-primary/50",
            "placeholder:text-muted-foreground/60",
            "transition-all duration-200"
          )}
        />

        {/* Clear Button */}
        {localValue && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-muted-foreground hover:text-foreground"
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
