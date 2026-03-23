import { cn } from "@/lib/utils";

export const BANNER_PRESETS: Record<string, string> = {
  "gradient-1": "linear-gradient(135deg, #0f0f1a 0%, #1a1040 50%, #0d1f3c 100%)",
  "gradient-2": "linear-gradient(135deg, #0a0a0f 0%, #1a2a1a 50%, #0f1a0f 100%)",
  "gradient-3": "linear-gradient(135deg, #1a0a0a 0%, #2d1010 50%, #1a0505 100%)",
  "gradient-4": "linear-gradient(135deg, #0f1a2a 0%, #1a2d3d 50%, #0a1520 100%)",
  "gradient-5": "linear-gradient(135deg, #1a1a0a 0%, #2d2d10 50%, #1a1a05 100%)",
  "gradient-6": "linear-gradient(135deg, #0a1a1a 0%, #102d2d 50%, #051a1a 100%)",
  "gradient-7": "linear-gradient(135deg, #1a0a1a 0%, #2d102d 50%, #1a051a 100%)",
  "gradient-8": "linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 50%, #0a0a0a 100%)",
};

interface ProfileBannerProps {
  bannerImage?: string | null;
  className?: string;
}

export function ProfileBanner({ bannerImage, className }: ProfileBannerProps) {
  const getBannerStyle = (): React.CSSProperties => {
    if (!bannerImage) {
      return { background: BANNER_PRESETS["gradient-1"] };
    }
    if (bannerImage.startsWith("gradient:")) {
      const key = bannerImage.replace("gradient:", "");
      const gradient = BANNER_PRESETS[key];
      return gradient ? { background: gradient } : { background: BANNER_PRESETS["gradient-1"] };
    }
    // Check if it's one of the preset keys directly
    if (BANNER_PRESETS[bannerImage]) {
      return { background: BANNER_PRESETS[bannerImage] };
    }
    // It's a URL
    return {
      backgroundImage: `url(${bannerImage})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  };

  return (
    <div
      className={cn("w-full h-36 md:h-44", className)}
      style={getBannerStyle()}
    />
  );
}
