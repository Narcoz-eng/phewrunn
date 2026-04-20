export const RAID_MEME_EXPORT_WIDTH = 1200;
export const RAID_MEME_EXPORT_HEIGHT = 1200;

export type RaidMemeTemplateId =
  | "chart-rat"
  | "breaking-news"
  | "courtroom"
  | "group-chat"
  | "night-shift"
  | "brain-rot-board";

export type RaidMemeTemplate = {
  id: RaidMemeTemplateId;
  label: string;
  description: string;
  backgroundStart: string;
  backgroundMid: string;
  backgroundEnd: string;
  accent: string;
  accentSoft: string;
  panel: string;
};

export const RAID_MEME_TEMPLATE_LIBRARY: Record<RaidMemeTemplateId, RaidMemeTemplate> = {
  "chart-rat": {
    id: "chart-rat",
    label: "Chart Rat",
    description: "Smug chart-room flex",
    backgroundStart: "#06131a",
    backgroundMid: "#0f2430",
    backgroundEnd: "#163f35",
    accent: "#6affb4",
    accentSoft: "rgba(106,255,180,0.18)",
    panel: "rgba(6, 12, 18, 0.76)",
  },
  "breaking-news": {
    id: "breaking-news",
    label: "Breaking News",
    description: "Desk alert bulletin",
    backgroundStart: "#201114",
    backgroundMid: "#431d24",
    backgroundEnd: "#8f2734",
    accent: "#ffcf6d",
    accentSoft: "rgba(255,207,109,0.18)",
    panel: "rgba(33, 10, 12, 0.8)",
  },
  courtroom: {
    id: "courtroom",
    label: "Courtroom",
    description: "Cross-exam energy",
    backgroundStart: "#1a1710",
    backgroundMid: "#352818",
    backgroundEnd: "#64431e",
    accent: "#ffd88c",
    accentSoft: "rgba(255,216,140,0.18)",
    panel: "rgba(27, 20, 10, 0.82)",
  },
  "group-chat": {
    id: "group-chat",
    label: "Group Chat",
    description: "Unread-message chaos",
    backgroundStart: "#111522",
    backgroundMid: "#232f5f",
    backgroundEnd: "#3159a4",
    accent: "#8bc6ff",
    accentSoft: "rgba(139,198,255,0.16)",
    panel: "rgba(12, 16, 30, 0.82)",
  },
  "night-shift": {
    id: "night-shift",
    label: "Night Shift",
    description: "Sleepless desk energy",
    backgroundStart: "#140f23",
    backgroundMid: "#2f1c55",
    backgroundEnd: "#6f43a8",
    accent: "#c8a0ff",
    accentSoft: "rgba(200,160,255,0.18)",
    panel: "rgba(17, 10, 28, 0.82)",
  },
  "brain-rot-board": {
    id: "brain-rot-board",
    label: "Evidence Board",
    description: "Conspiracy wall with receipts",
    backgroundStart: "#151811",
    backgroundMid: "#24331b",
    backgroundEnd: "#4c6f2d",
    accent: "#d8ff76",
    accentSoft: "rgba(216,255,118,0.18)",
    panel: "rgba(12, 16, 10, 0.82)",
  },
};
