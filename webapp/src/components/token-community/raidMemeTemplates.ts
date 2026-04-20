export const RAID_MEME_EXPORT_WIDTH = 1200;
export const RAID_MEME_EXPORT_HEIGHT = 1200;

export type RaidMemeTemplateId =
  | "chart-rat"
  | "breaking-news"
  | "courtroom"
  | "group-chat"
  | "night-shift"
  | "brain-rot-board"
  | "mascot-poster"
  | "reference-remix"
  | "market-flex";

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
  panelSecondary: string;
  textPrimary: string;
  textSecondary: string;
};

export const RAID_MEME_TEMPLATE_LIBRARY: Record<RaidMemeTemplateId, RaidMemeTemplate> = {
  "chart-rat": {
    id: "chart-rat",
    label: "Chart Rat",
    description: "Chart-room flex with loud conviction",
    backgroundStart: "#05121a",
    backgroundMid: "#0e2a36",
    backgroundEnd: "#145243",
    accent: "#79ffca",
    accentSoft: "rgba(121,255,202,0.24)",
    panel: "rgba(6, 14, 18, 0.82)",
    panelSecondary: "rgba(9, 24, 30, 0.72)",
    textPrimary: "#f8fafc",
    textSecondary: "rgba(226,232,240,0.82)",
  },
  "breaking-news": {
    id: "breaking-news",
    label: "Breaking News",
    description: "Market desk bulletin with a siren on",
    backgroundStart: "#170d12",
    backgroundMid: "#531924",
    backgroundEnd: "#bc2e46",
    accent: "#ffd06e",
    accentSoft: "rgba(255,208,110,0.2)",
    panel: "rgba(33, 9, 14, 0.84)",
    panelSecondary: "rgba(58, 14, 22, 0.72)",
    textPrimary: "#fff7ed",
    textSecondary: "rgba(255,237,213,0.82)",
  },
  courtroom: {
    id: "courtroom",
    label: "Courtroom",
    description: "Receipts-on-record energy",
    backgroundStart: "#140f0b",
    backgroundMid: "#392715",
    backgroundEnd: "#71512a",
    accent: "#ffdd9a",
    accentSoft: "rgba(255,221,154,0.22)",
    panel: "rgba(23, 15, 10, 0.84)",
    panelSecondary: "rgba(46, 29, 15, 0.72)",
    textPrimary: "#fff8ea",
    textSecondary: "rgba(255,237,213,0.82)",
  },
  "group-chat": {
    id: "group-chat",
    label: "Group Chat Spiral",
    description: "Unread chaos with suspiciously good timing",
    backgroundStart: "#111525",
    backgroundMid: "#27346b",
    backgroundEnd: "#3d6ce0",
    accent: "#9dd4ff",
    accentSoft: "rgba(157,212,255,0.22)",
    panel: "rgba(11, 15, 29, 0.84)",
    panelSecondary: "rgba(26, 37, 76, 0.7)",
    textPrimary: "#eff6ff",
    textSecondary: "rgba(219,234,254,0.84)",
  },
  "night-shift": {
    id: "night-shift",
    label: "Night Shift",
    description: "2:14 a.m. terminal energy",
    backgroundStart: "#120d1d",
    backgroundMid: "#2e1854",
    backgroundEnd: "#7a43ba",
    accent: "#d9b8ff",
    accentSoft: "rgba(217,184,255,0.22)",
    panel: "rgba(16, 10, 26, 0.84)",
    panelSecondary: "rgba(36, 18, 56, 0.7)",
    textPrimary: "#faf5ff",
    textSecondary: "rgba(243,232,255,0.82)",
  },
  "brain-rot-board": {
    id: "brain-rot-board",
    label: "Evidence Board",
    description: "Thread-room conspiracy board",
    backgroundStart: "#10150d",
    backgroundMid: "#28331a",
    backgroundEnd: "#5f7e2c",
    accent: "#e6ff7c",
    accentSoft: "rgba(230,255,124,0.22)",
    panel: "rgba(12, 17, 10, 0.84)",
    panelSecondary: "rgba(25, 34, 18, 0.7)",
    textPrimary: "#f7fee7",
    textSecondary: "rgba(236,252,203,0.82)",
  },
  "mascot-poster": {
    id: "mascot-poster",
    label: "Mascot Poster",
    description: "Big identity poster with mascot heat",
    backgroundStart: "#171214",
    backgroundMid: "#42222e",
    backgroundEnd: "#ff5d78",
    accent: "#ffe07a",
    accentSoft: "rgba(255,224,122,0.22)",
    panel: "rgba(26, 12, 17, 0.82)",
    panelSecondary: "rgba(60, 23, 34, 0.68)",
    textPrimary: "#fff7f7",
    textSecondary: "rgba(255,228,230,0.84)",
  },
  "reference-remix": {
    id: "reference-remix",
    label: "Reference Remix",
    description: "Collage remix from the room's own memes",
    backgroundStart: "#0f1118",
    backgroundMid: "#26213f",
    backgroundEnd: "#7a5af8",
    accent: "#7cf3ff",
    accentSoft: "rgba(124,243,255,0.2)",
    panel: "rgba(13, 14, 22, 0.82)",
    panelSecondary: "rgba(26, 24, 46, 0.68)",
    textPrimary: "#f5f3ff",
    textSecondary: "rgba(221,214,254,0.84)",
  },
  "market-flex": {
    id: "market-flex",
    label: "Market Flex",
    description: "Cleaner desk flex for sharper raids",
    backgroundStart: "#0d1216",
    backgroundMid: "#17333b",
    backgroundEnd: "#29b37c",
    accent: "#d6ff88",
    accentSoft: "rgba(214,255,136,0.22)",
    panel: "rgba(8, 13, 17, 0.84)",
    panelSecondary: "rgba(12, 26, 30, 0.72)",
    textPrimary: "#f0fdf4",
    textSecondary: "rgba(220,252,231,0.84)",
  },
};
