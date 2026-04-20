import type { TokenCommunityAsset, TokenRaidMemeOption } from "@/types";
import {
  RAID_MEME_EXPORT_HEIGHT,
  RAID_MEME_EXPORT_WIDTH,
  RAID_MEME_TEMPLATE_LIBRARY,
  type RaidMemeTemplate,
  type RaidMemeTemplateId,
} from "./raidMemeTemplates";

export type RaidMemeTokenContext = {
  tokenLabel: string;
  communityTag: string;
  roomHeadline?: string | null;
};

export type RaidMemeAssetContext = {
  logo?: TokenCommunityAsset | null;
  banner?: TokenCommunityAsset | null;
  mascot?: TokenCommunityAsset | null;
  referenceMemes?: TokenCommunityAsset[];
};

type SelectedAssetSet = {
  logo: TokenCommunityAsset | null;
  banner: TokenCommunityAsset | null;
  mascot: TokenCommunityAsset | null;
  references: TokenCommunityAsset[];
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
  anchor: "start" | "middle" | "end" = "start",
): string {
  return `<text x="${x}" y="${y}" class="${className}" text-anchor="${anchor}">${lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join("")}</text>`;
}

function resolveTemplate(templateId: string): RaidMemeTemplate {
  return (
    RAID_MEME_TEMPLATE_LIBRARY[(templateId as RaidMemeTemplateId) || "market-flex"] ??
    RAID_MEME_TEMPLATE_LIBRARY["market-flex"]
  );
}

function findById(items: TokenCommunityAsset[], ids: string[]): TokenCommunityAsset[] {
  const idSet = new Set(ids);
  return items.filter((item) => idSet.has(item.id));
}

function resolveAssets(option: TokenRaidMemeOption, assets?: RaidMemeAssetContext | null): SelectedAssetSet {
  const referenceMemes = assets?.referenceMemes ?? [];
  const assetIds = option.assetIdsUsed ?? [];
  const referenced = findById(referenceMemes, assetIds).slice(0, 3);

  const mascotAllowed = assetIds.length === 0 || assetIds.includes(assets?.mascot?.id ?? "");
  const logoAllowed = assetIds.length === 0 || assetIds.includes(assets?.logo?.id ?? "");
  const bannerAllowed = assetIds.length === 0 || assetIds.includes(assets?.banner?.id ?? "");

  return {
    logo: logoAllowed ? assets?.logo ?? null : null,
    banner: bannerAllowed ? assets?.banner ?? null : null,
    mascot: mascotAllowed ? assets?.mascot ?? null : null,
    references: referenced.length > 0 ? referenced : referenceMemes.slice(0, 3),
  };
}

function renderImage(
  id: string,
  asset: TokenCommunityAsset | null | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  opacity = 1,
): string {
  if (!asset) return "";
  return `
    <g clip-path="url(#${id})" opacity="${opacity}">
      <image href="${escapeXml(asset.renderUrl)}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" />
    </g>
  `;
}

function renderReferenceStack(referenceAssets: TokenCommunityAsset[], positions: Array<{ x: number; y: number; rotate: number }>): string {
  return referenceAssets
    .slice(0, positions.length)
    .map((asset, index) => {
      const position = positions[index]!;
      return `
        <g transform="translate(${position.x} ${position.y}) rotate(${position.rotate})">
          <rect x="0" y="0" width="210" height="250" rx="22" fill="rgba(255,255,255,0.92)" />
          <rect x="14" y="14" width="182" height="176" rx="18" fill="rgba(15,23,42,0.16)" />
          <clipPath id="reference-clip-${index}">
            <rect x="${position.x + 14}" y="${position.y + 14}" width="182" height="176" rx="18" />
          </clipPath>
          ${renderImage(`reference-clip-${index}`, asset, position.x + 14, position.y + 14, 182, 176)}
          <text x="18" y="220" class="referenceLabel">${escapeXml(asset.kind === "reference_meme" ? "room reference" : "brand asset")}</text>
        </g>
      `;
    })
    .join("");
}

function buildSceneArt(
  template: RaidMemeTemplate,
  option: TokenRaidMemeOption,
  token: RaidMemeTokenContext,
  selectedAssets: SelectedAssetSet,
): string {
  const bannerLayer = selectedAssets.banner
    ? `
        <clipPath id="banner-clip">
          <rect x="54" y="54" width="1092" height="310" rx="40" />
        </clipPath>
        ${renderImage("banner-clip", selectedAssets.banner, 54, 54, 1092, 310, 0.34)}
      `
    : "";

  const logoLayer = selectedAssets.logo
    ? `
        <clipPath id="logo-clip">
          <circle cx="1050" cy="152" r="58" />
        </clipPath>
        <circle cx="1050" cy="152" r="62" fill="rgba(255,255,255,0.12)" stroke="${template.accent}" stroke-width="4" />
        ${renderImage("logo-clip", selectedAssets.logo, 992, 94, 116, 116)}
      `
    : `
        <circle cx="1050" cy="152" r="62" fill="rgba(255,255,255,0.08)" stroke="${template.accent}" stroke-width="4" />
        <text x="1050" y="164" class="logoFallback" text-anchor="middle">${escapeXml(token.communityTag.slice(0, 3))}</text>
      `;

  const mascotFrame = selectedAssets.mascot
    ? `
        <clipPath id="mascot-clip">
          <rect x="748" y="280" width="320" height="408" rx="34" />
        </clipPath>
        <rect x="732" y="264" width="352" height="440" rx="38" fill="rgba(255,255,255,0.10)" stroke="${template.accent}" stroke-width="3" />
        ${renderImage("mascot-clip", selectedAssets.mascot, 748, 280, 320, 408)}
      `
    : `
        <rect x="752" y="288" width="316" height="400" rx="32" fill="${template.panelSecondary}" stroke="${template.accent}" stroke-opacity="0.65" />
        <text x="910" y="500" class="mascotFallback" text-anchor="middle">${escapeXml(option.title)}</text>
      `;

  const referenceStack = renderReferenceStack(selectedAssets.references, [
    { x: 796, y: 336, rotate: 8 },
    { x: 944, y: 462, rotate: -6 },
    { x: 726, y: 510, rotate: -10 },
  ]);

  switch (template.id) {
    case "mascot-poster":
      return `
        ${bannerLayer}
        ${logoLayer}
        ${mascotFrame}
        <rect x="86" y="312" width="560" height="504" rx="38" fill="${template.panelSecondary}" stroke="${template.accentSoft}" />
        <circle cx="688" cy="884" r="154" fill="${template.accentSoft}" />
      `;
    case "reference-remix":
      return `
        ${bannerLayer}
        ${logoLayer}
        <rect x="80" y="302" width="500" height="420" rx="36" fill="${template.panelSecondary}" />
        <rect x="80" y="760" width="1040" height="124" rx="30" fill="rgba(255,255,255,0.08)" />
        ${referenceStack || mascotFrame}
      `;
    case "market-flex":
      return `
        ${bannerLayer}
        ${logoLayer}
        <path d="M112 902 C238 836 372 846 488 744 C614 632 786 646 924 516 C980 466 1036 418 1090 350" stroke="${template.accent}" stroke-width="18" fill="none" stroke-linecap="round" />
        <circle cx="1090" cy="350" r="16" fill="${template.accent}" />
        <rect x="94" y="792" width="1012" height="230" rx="34" fill="${template.panelSecondary}" stroke="${template.accentSoft}" />
      `;
    case "courtroom":
      return `
        ${bannerLayer}
        ${logoLayer}
        ${selectedAssets.references.length > 0 ? referenceStack : mascotFrame}
        <rect x="118" y="876" width="964" height="160" rx="28" fill="${template.panelSecondary}" />
      `;
    case "group-chat":
      return `
        ${bannerLayer}
        ${logoLayer}
        <rect x="116" y="270" width="472" height="126" rx="30" fill="rgba(255,255,255,0.12)" />
        <rect x="562" y="726" width="494" height="134" rx="30" fill="${template.accentSoft}" />
        ${selectedAssets.mascot ? mascotFrame : referenceStack}
      `;
    case "brain-rot-board":
      return `
        ${bannerLayer}
        ${logoLayer}
        <path d="M214 254 L420 424 M420 424 L760 270 M420 424 L964 542 M420 424 L750 852" stroke="${template.accentSoft}" stroke-width="9" />
        <circle cx="420" cy="424" r="28" fill="${template.accent}" />
        ${referenceStack || mascotFrame}
      `;
    case "breaking-news":
      return `
        ${bannerLayer}
        <rect x="84" y="94" width="448" height="60" rx="18" fill="${template.accent}" />
        <rect x="84" y="168" width="980" height="10" rx="5" fill="rgba(255,255,255,0.16)" />
        <rect x="84" y="188" width="818" height="10" rx="5" fill="rgba(255,255,255,0.1)" />
        ${logoLayer}
        ${selectedAssets.references.length > 0 ? referenceStack : mascotFrame}
      `;
    case "night-shift":
      return `
        ${bannerLayer}
        ${logoLayer}
        <circle cx="980" cy="208" r="136" fill="${template.accentSoft}" />
        <rect x="132" y="892" width="222" height="120" rx="28" fill="rgba(255,255,255,0.08)" />
        <rect x="380" y="846" width="286" height="170" rx="28" fill="rgba(255,255,255,0.06)" />
        ${selectedAssets.mascot ? mascotFrame : referenceStack}
      `;
    case "chart-rat":
    default:
      return `
        ${bannerLayer}
        ${logoLayer}
        <circle cx="1002" cy="178" r="108" fill="${template.accentSoft}" />
        <path d="M116 952 C282 748 432 864 566 702 C704 532 874 610 1042 390" stroke="${template.accent}" stroke-width="16" fill="none" stroke-linecap="round" />
        <circle cx="1042" cy="390" r="18" fill="${template.accent}" />
        ${selectedAssets.mascot ? mascotFrame : referenceStack}
      `;
  }
}

export function buildRaidMemeSvg(
  option: TokenRaidMemeOption,
  token: RaidMemeTokenContext,
  assets?: RaidMemeAssetContext | null,
): string {
  const template = resolveTemplate(option.templateId);
  const selectedAssets = resolveAssets(option, assets);
  const titleLines = wrapText(option.topText, template.id === "reference-remix" ? 18 : 20, 4);
  const subtitleLines = wrapText(option.bottomText, 33, 3);
  const kicker = clampText(option.kicker || token.tokenLabel, 72);
  const footer = clampText(option.footer || token.communityTag, 78);
  const angleChip = clampText(option.angle, 28);
  const roomHeadline = clampText(token.roomHeadline || option.title, 68);

  const textAnchor = template.id === "group-chat" ? "middle" : "start";
  const titleX = template.id === "group-chat" ? 362 : 104;
  const titleY =
    template.id === "breaking-news"
      ? 286
      : template.id === "group-chat"
        ? 334
        : template.id === "mascot-poster"
          ? 422
          : 354;
  const subtitleX = template.id === "group-chat" ? 362 : 104;
  const subtitleY =
    template.id === "reference-remix"
      ? 792
      : template.id === "mascot-poster"
        ? 742
        : 762;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${RAID_MEME_EXPORT_WIDTH}" height="${RAID_MEME_EXPORT_HEIGHT}" viewBox="0 0 ${RAID_MEME_EXPORT_WIDTH} ${RAID_MEME_EXPORT_HEIGHT}">
      <defs>
        <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${template.backgroundStart}" />
          <stop offset="48%" stop-color="${template.backgroundMid}" />
          <stop offset="100%" stop-color="${template.backgroundEnd}" />
        </linearGradient>
        <linearGradient id="panelBorder" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${template.accent}" stop-opacity="0.7" />
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0.10" />
        </linearGradient>
        <linearGradient id="topFade" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="rgba(5,10,20,0.12)" />
          <stop offset="100%" stop-color="rgba(5,10,20,0.62)" />
        </linearGradient>
      </defs>
      <rect width="1200" height="1200" fill="url(#bgGradient)" />
      ${buildSceneArt(template, option, token, selectedAssets)}
      <rect x="52" y="52" width="1096" height="1096" rx="42" fill="${template.panel}" stroke="url(#panelBorder)" stroke-width="2.5" />
      <rect x="86" y="110" width="238" height="44" rx="16" fill="rgba(255,255,255,0.08)" />
      <text x="106" y="140" class="eyebrow">${escapeXml(token.communityTag)}</text>
      <text x="1110" y="140" class="eyebrow" text-anchor="end">${escapeXml(angleChip)}</text>
      <text x="108" y="202" class="kicker">${escapeXml(roomHeadline)}</text>
      <text x="${template.id === "group-chat" ? 362 : 110}" y="244" class="pill" ${template.id === "group-chat" ? 'text-anchor="middle"' : ""}>${escapeXml(option.title)}</text>
      ${renderTextLines(titleLines, titleX, titleY, 78, "headline", textAnchor as "start" | "middle")}
      ${renderTextLines(subtitleLines, subtitleX, subtitleY, 48, "bodyLarge", textAnchor as "start" | "middle")}
      <rect x="94" y="930" width="1012" height="176" rx="30" fill="${template.panelSecondary}" stroke="${template.accentSoft}" />
      <text x="128" y="980" class="metaLabel">${escapeXml(kicker)}</text>
      <text x="128" y="1032" class="metaValue">${escapeXml(token.tokenLabel)}</text>
      <text x="128" y="1080" class="metaFooter">${escapeXml(footer)}</text>
      <text x="1062" y="1080" class="socialTag" text-anchor="end">${escapeXml(option.socialTag || option.toneLabel)}</text>
      <style>
        .eyebrow { fill: ${template.textSecondary}; font: 700 24px 'Inter', sans-serif; letter-spacing: 0.16em; text-transform: uppercase; }
        .pill { fill: ${template.textSecondary}; font: 800 28px 'Inter', sans-serif; letter-spacing: 0.04em; text-transform: uppercase; }
        .kicker { fill: ${template.textSecondary}; font: 700 24px 'Inter', sans-serif; }
        .headline { fill: ${template.textPrimary}; font: 900 76px 'Arial Black', 'Inter', sans-serif; letter-spacing: -0.05em; }
        .bodyLarge { fill: ${template.textSecondary}; font: 700 40px 'Inter', sans-serif; }
        .metaLabel { fill: ${template.textSecondary}; font: 700 20px 'Inter', sans-serif; letter-spacing: 0.14em; text-transform: uppercase; }
        .metaValue { fill: ${template.textPrimary}; font: 900 46px 'Arial Black', 'Inter', sans-serif; letter-spacing: -0.04em; }
        .metaFooter { fill: ${template.textSecondary}; font: 600 26px 'Inter', sans-serif; }
        .socialTag { fill: ${template.accent}; font: 800 22px 'Inter', sans-serif; text-transform: uppercase; letter-spacing: 0.1em; }
        .logoFallback { fill: ${template.textPrimary}; font: 900 28px 'Arial Black', 'Inter', sans-serif; text-transform: uppercase; }
        .mascotFallback { fill: ${template.textSecondary}; font: 800 28px 'Inter', sans-serif; letter-spacing: 0.06em; }
        .referenceLabel { fill: rgba(15,23,42,0.86); font: 700 16px 'Inter', sans-serif; text-transform: uppercase; letter-spacing: 0.08em; }
      </style>
    </svg>
  `;
}

export function buildRaidMemeDataUrl(
  option: TokenRaidMemeOption,
  token: RaidMemeTokenContext,
  assets?: RaidMemeAssetContext | null,
): string {
  const svg = buildRaidMemeSvg(option, token, assets);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function renderRaidMemePngBlob(
  option: TokenRaidMemeOption,
  token: RaidMemeTokenContext,
  assets?: RaidMemeAssetContext | null,
): Promise<Blob> {
  const dataUrl = buildRaidMemeDataUrl(option, token, assets);
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
