import type { TokenRaidMemeOption } from "@/types";
import {
  RAID_MEME_EXPORT_HEIGHT,
  RAID_MEME_EXPORT_WIDTH,
  RAID_MEME_TEMPLATE_LIBRARY,
  type RaidMemeTemplate,
  type RaidMemeTemplateId,
} from "./raidMemeTemplates";

type RaidMemeTokenContext = {
  tokenLabel: string;
  communityTag: string;
};

function escapeXml(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function clampText(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function wrapText(value: string, maxChars: number, maxLines: number): string[] {
  const words = value.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) {
      lines.push(current);
      current = word;
    } else {
      lines.push(clampText(word, maxChars));
      current = "";
    }
    if (lines.length === maxLines) break;
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  if (lines.length > maxLines) {
    lines.length = maxLines;
  }

  if (lines.length === maxLines) {
    lines[maxLines - 1] = clampText(lines[maxLines - 1] ?? "", maxChars);
  }

  return lines;
}

function renderTextLines(
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
  className: string,
  anchor: "start" | "middle" = "start",
): string {
  return `<text x="${x}" y="${y}" class="${className}" text-anchor="${anchor}">${lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join("")}</text>`;
}

function resolveTemplate(templateId: string): RaidMemeTemplate {
  return RAID_MEME_TEMPLATE_LIBRARY[(templateId as RaidMemeTemplateId) || "chart-rat"] ?? RAID_MEME_TEMPLATE_LIBRARY["chart-rat"];
}

export function buildRaidMemeSvg(option: TokenRaidMemeOption, token: RaidMemeTokenContext): string {
  const template = resolveTemplate(option.templateId);
  const titleLines = wrapText(option.topText, 22, 3);
  const subtitleLines = wrapText(option.bottomText, 34, 3);
  const kicker = clampText(option.kicker || token.tokenLabel, 56);
  const footer = clampText(option.footer || token.communityTag, 56);
  const objectiveBadge = clampText(option.angle, 28);
  const titleY = template.id === "breaking-news" ? 284 : template.id === "group-chat" ? 320 : 350;

  const floatingElements = {
    "chart-rat": `
      <circle cx="1000" cy="170" r="110" fill="${template.accentSoft}" />
      <path d="M110 960 C280 740 430 860 560 700 C700 520 870 600 1040 380" stroke="${template.accent}" stroke-width="16" fill="none" stroke-linecap="round" />
      <circle cx="1040" cy="380" r="18" fill="${template.accent}" />
    `,
    "breaking-news": `
      <rect x="84" y="98" width="420" height="58" rx="18" fill="${template.accent}" />
      <rect x="84" y="166" width="1030" height="10" rx="5" fill="rgba(255,255,255,0.16)" />
      <rect x="84" y="186" width="860" height="10" rx="5" fill="rgba(255,255,255,0.1)" />
    `,
    courtroom: `
      <rect x="144" y="886" width="912" height="160" rx="26" fill="rgba(0,0,0,0.18)" stroke="${template.accentSoft}" />
      <circle cx="970" cy="242" r="92" fill="${template.accentSoft}" />
    `,
    "group-chat": `
      <rect x="126" y="190" width="520" height="120" rx="32" fill="rgba(255,255,255,0.10)" />
      <rect x="560" y="760" width="500" height="126" rx="32" fill="${template.accentSoft}" />
    `,
    "night-shift": `
      <circle cx="980" cy="200" r="132" fill="${template.accentSoft}" />
      <rect x="128" y="894" width="210" height="120" rx="28" fill="rgba(255,255,255,0.08)" />
      <rect x="366" y="850" width="270" height="164" rx="28" fill="rgba(255,255,255,0.06)" />
    `,
    "brain-rot-board": `
      <path d="M210 220 L420 420 M420 420 L770 260 M420 420 L940 570 M420 420 L750 860" stroke="${template.accentSoft}" stroke-width="8" />
      <circle cx="420" cy="420" r="28" fill="${template.accent}" />
      <rect x="706" y="210" width="152" height="88" rx="20" fill="rgba(255,255,255,0.08)" />
      <rect x="870" y="520" width="184" height="104" rx="20" fill="rgba(255,255,255,0.08)" />
    `,
  }[template.id];

  const titleBlock =
    template.id === "breaking-news"
      ? renderTextLines(titleLines, 104, titleY, 84, "headline")
      : template.id === "group-chat"
        ? renderTextLines(titleLines, 600, titleY, 84, "headline", "middle")
        : renderTextLines(titleLines, 110, titleY, 84, "headline");

  const bottomBlock =
    template.id === "group-chat"
      ? renderTextLines(subtitleLines, 600, 770, 52, "bodyLarge", "middle")
      : renderTextLines(subtitleLines, 110, 760, 52, "bodyLarge");

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${RAID_MEME_EXPORT_WIDTH}" height="${RAID_MEME_EXPORT_HEIGHT}" viewBox="0 0 ${RAID_MEME_EXPORT_WIDTH} ${RAID_MEME_EXPORT_HEIGHT}">
    <defs>
      <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${template.backgroundStart}" />
        <stop offset="52%" stop-color="${template.backgroundMid}" />
        <stop offset="100%" stop-color="${template.backgroundEnd}" />
      </linearGradient>
      <linearGradient id="panelBorder" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${template.accent}" stop-opacity="0.55" />
        <stop offset="100%" stop-color="#ffffff" stop-opacity="0.12" />
      </linearGradient>
    </defs>
    <rect width="1200" height="1200" fill="url(#bgGradient)" />
    ${floatingElements}
    <rect x="52" y="52" width="1096" height="1096" rx="42" fill="${template.panel}" stroke="url(#panelBorder)" stroke-width="2" />
    <text x="94" y="140" class="eyebrow">${escapeXml(token.communityTag)}</text>
    <text x="1106" y="140" class="eyebrow" text-anchor="end">${escapeXml(objectiveBadge)}</text>
    <text x="104" y="136" class="pill" fill="${template.id === "breaking-news" ? "#1f1012" : "#081015"}">${escapeXml(option.title)}</text>
    ${titleBlock}
    ${bottomBlock}
    <rect x="96" y="908" width="1008" height="170" rx="30" fill="rgba(255,255,255,0.06)" stroke="${template.accentSoft}" />
    <text x="126" y="960" class="metaLabel">${escapeXml(kicker)}</text>
    <text x="126" y="1014" class="metaValue">${escapeXml(token.tokenLabel)}</text>
    <text x="126" y="1064" class="metaFooter">${escapeXml(footer)}</text>
    <style>
      .eyebrow { fill: rgba(241,245,249,0.76); font: 700 26px 'Inter', sans-serif; letter-spacing: 0.18em; text-transform: uppercase; }
      .pill { font: 800 28px 'Inter', sans-serif; }
      .headline { fill: #ffffff; font: 900 74px 'Arial Black', 'Inter', sans-serif; letter-spacing: -0.04em; }
      .bodyLarge { fill: rgba(241,245,249,0.94); font: 700 42px 'Inter', sans-serif; }
      .metaLabel { fill: rgba(241,245,249,0.76); font: 700 22px 'Inter', sans-serif; letter-spacing: 0.14em; text-transform: uppercase; }
      .metaValue { fill: #ffffff; font: 900 48px 'Arial Black', 'Inter', sans-serif; letter-spacing: -0.04em; }
      .metaFooter { fill: rgba(241,245,249,0.78); font: 600 28px 'Inter', sans-serif; }
    </style>
  </svg>
  `;
}

export function buildRaidMemeDataUrl(option: TokenRaidMemeOption, token: RaidMemeTokenContext): string {
  const svg = buildRaidMemeSvg(option, token);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function renderRaidMemePngBlob(
  option: TokenRaidMemeOption,
  token: RaidMemeTokenContext,
): Promise<Blob> {
  const dataUrl = buildRaidMemeDataUrl(option, token);
  const image = new Image();
  image.decoding = "async";
  image.src = dataUrl;

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Failed to load meme preview"));
  });

  const canvas = document.createElement("canvas");
  canvas.width = RAID_MEME_EXPORT_WIDTH;
  canvas.height = RAID_MEME_EXPORT_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to create meme canvas");
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), "image/png", 1);
  });

  if (!blob) {
    throw new Error("Failed to encode meme image");
  }

  return blob;
}
