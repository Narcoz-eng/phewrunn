import { useState } from "react";
import { cn } from "@/lib/utils";
import { BANNER_CONFIGS, getBannerConfig } from "./ProfileBanner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Lock } from "lucide-react";

const LEVEL_GROUPS = [
  { label: "Free", minLevel: 0 },
  { label: "Level 3 · Credible", minLevel: 3 },
  { label: "Level 5 · Veteran", minLevel: 5 },
  { label: "Level 7 · High Veteran", minLevel: 7 },
  { label: "Level 10 · Apex", minLevel: 10 },
];

interface BannerPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentBanner?: string | null;
  userLevel: number;
  onSelect: (bannerValue: string) => void;
}

export function BannerPicker({
  open,
  onOpenChange,
  currentBanner,
  userLevel,
  onSelect,
}: BannerPickerProps) {
  const currentConfig = getBannerConfig(currentBanner);
  const [selected, setSelected] = useState<string>(currentConfig.key);

  const handleSave = () => {
    onSelect(selected);
    onOpenChange(false);
  };

  const selectedConfig = BANNER_CONFIGS.find((b) => b.key === selected) ?? BANNER_CONFIGS[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Choose Banner</DialogTitle>
        </DialogHeader>

        {/* Preview of selected banner */}
        <div className="rounded-lg overflow-hidden border border-border">
          <div
            className="h-20 w-full transition-all duration-500"
            style={
              selectedConfig.animated
                ? {
                    background: selectedConfig.gradient,
                    backgroundSize: "400% 400%",
                    animation: `${selectedConfig.animationName} ${selectedConfig.key === "apex" ? "6s" : "8s"} ease infinite`,
                  }
                : { background: selectedConfig.gradient }
            }
          />
        </div>
        <p className="text-xs text-center font-medium text-muted-foreground -mt-1">
          {selectedConfig.label}
          {selectedConfig.animated ? (
            <span className="ml-1.5 text-primary/70">• animated</span>
          ) : null}
        </p>

        {/* Groups */}
        <div className="space-y-4 mt-1">
          {LEVEL_GROUPS.map((group) => {
            const groupBanners = BANNER_CONFIGS.filter(
              (b) => b.requiredLevel === group.minLevel
            );
            if (groupBanners.length === 0) return null;
            const groupLocked = userLevel < group.minLevel;

            return (
              <div key={group.label}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {group.label}
                  </span>
                  {groupLocked ? (
                    <div className="flex items-center gap-1 text-[10px] text-amber-500/80 font-medium">
                      <Lock className="h-2.5 w-2.5" />
                      Reach Level {group.minLevel}
                    </div>
                  ) : null}
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {groupBanners.map((banner) => {
                    const isLocked = userLevel < banner.requiredLevel;
                    const isSelected = selected === banner.key;

                    return (
                      <button
                        key={banner.key}
                        disabled={isLocked}
                        onClick={() => !isLocked && setSelected(banner.key)}
                        className={cn(
                          "relative h-14 rounded-md overflow-hidden border-2 transition-all",
                          isSelected
                            ? "border-primary ring-2 ring-primary ring-offset-2 ring-offset-background scale-105"
                            : isLocked
                              ? "border-border/30 opacity-40 cursor-not-allowed"
                              : "border-border hover:border-primary/50 hover:scale-105 cursor-pointer"
                        )}
                        style={
                          banner.animated
                            ? {
                                background: banner.gradient,
                                backgroundSize: "400% 400%",
                                animation: `${banner.animationName} 8s ease infinite`,
                              }
                            : { background: banner.gradient }
                        }
                        title={banner.label}
                        aria-label={banner.label}
                      >
                        {isLocked ? (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                            <Lock className="h-3 w-3 text-white/60" />
                            <span className="text-[8px] text-white/60 font-bold">Lv{banner.requiredLevel}</span>
                          </div>
                        ) : isSelected ? (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="h-4 w-4 rounded-full bg-primary flex items-center justify-center shadow-lg">
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
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 mt-2 pt-2 border-t border-border">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={handleSave}>
            Save Banner
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
