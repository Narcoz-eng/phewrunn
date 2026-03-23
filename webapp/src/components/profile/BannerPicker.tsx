import { useState } from "react";
import { cn } from "@/lib/utils";
import { BANNER_PRESETS } from "./ProfileBanner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const BANNER_LABELS: Record<string, string> = {
  "gradient-1": "Deep Space",
  "gradient-2": "Matrix",
  "gradient-3": "Blood Red",
  "gradient-4": "Deep Ocean",
  "gradient-5": "Gold Dust",
  "gradient-6": "Teal Abyss",
  "gradient-7": "Void Purple",
  "gradient-8": "Pure Dark",
};

interface BannerPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentBanner?: string | null;
  onSelect: (bannerValue: string) => void;
}

export function BannerPicker({ open, onOpenChange, currentBanner, onSelect }: BannerPickerProps) {
  const [selected, setSelected] = useState<string>(currentBanner ?? "gradient-1");

  const handleSave = () => {
    onSelect(selected);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose a Banner</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-4 gap-2 mt-2">
          {Object.entries(BANNER_PRESETS).map(([key, gradient]) => (
            <button
              key={key}
              onClick={() => setSelected(key)}
              className={cn(
                "relative h-14 rounded-md overflow-hidden border-2 transition-all",
                selected === key
                  ? "border-primary ring-2 ring-primary ring-offset-2 ring-offset-background"
                  : "border-border hover:border-muted-foreground"
              )}
              style={{ background: gradient }}
              title={BANNER_LABELS[key]}
              aria-label={BANNER_LABELS[key]}
            >
              {selected === key && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                    <svg
                      className="h-2.5 w-2.5 text-primary-foreground"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                </div>
              )}
            </button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground text-center mt-1">
          {BANNER_LABELS[selected] ?? selected}
        </p>

        <div className="flex gap-2 mt-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={handleSave}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
