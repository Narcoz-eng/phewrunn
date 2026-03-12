export const WIN_CARD_EXPORT_WIDTH = 1200;
export const WIN_CARD_EXPORT_HEIGHT = 1280;

type WinCardTone = "gain" | "loss" | "plain";

type WinCardMetric = {
  label: string;
  value: string;
  hint: string;
  tone: WinCardTone;
  highlight?: boolean;
};

type WinCardSnapshot = {
  label: string;
  shortLabel: string;
  percentText: string;
  profitText: string;
  magnitudeRatio: number;
  positive: boolean | null;
};

export type WinCardSummaryItem = {
  label: string;
  value: string;
  hint: string;
  tone: WinCardTone;
};

export type WinCardRenderModel = {
  tone: WinCardTone;
  resultLabel: string;
  resultText: string;
  statusTitle: string;
  statusDetail: string;
  shareIntro: string;
  footerLabel: string;
  authorName: string;
  authorMeta: string;
  authorLevelLabel: string;
  authorLevelText: string;
  authorInitial: string;
  tokenPrimary: string;
  tokenSecondary: string;
  noteText: string;
  postIdText: string;
  performanceLabel: string;
  performanceValue: string;
  marketMoveLabel: string;
  marketMoveText: string;
  metrics: WinCardMetric[];
  snapshots: WinCardSnapshot[];
  summaryItems: WinCardSummaryItem[];
};

type BuildWinCardSvgOptions = {
  logoDataUrl?: string | null;
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
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function wrapText(value: string, maxChars: number, maxLines: number): string[] {
  const words = value.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (words.length === 0) {
    return [""];
  }

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
    if (lines.length === maxLines) {
      return lines.map((line, index) =>
        index === maxLines - 1 ? clampText(line, maxChars) : line
      );
    }
  }

  if (current) {
    lines.push(current);
  }

  if (lines.length > maxLines) {
    return lines.slice(0, maxLines).map((line, index) =>
      index === maxLines - 1 ? clampText(line, maxChars) : line
    );
  }

  return lines;
}

function renderTextLines(
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
  className: string
): string {
  return `<text x="${x}" y="${y}" class="${className}">${lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`
    )
    .join("")}</text>`;
}

function metricToneColors(tone: WinCardTone): { value: string; border: string } {
  if (tone === "gain") {
    return { value: "#b8ff73", border: "rgba(169,255,52,0.30)" };
  }
  if (tone === "loss") {
    return { value: "#ff8f9d", border: "rgba(255,121,143,0.30)" };
  }
  return { value: "#f8fafc", border: "rgba(255,255,255,0.14)" };
}

function snapshotFill(snapshot: WinCardSnapshot): string {
  if (snapshot.positive === null) {
    return "#6b7280";
  }
  return snapshot.positive ? "#7dff5a" : "#ff7f90";
}

function summaryToneColor(tone: WinCardTone): string {
  if (tone === "gain") return "#b8ff73";
  if (tone === "loss") return "#ff8f9d";
  return "#f8fafc";
}

export function buildWinCardSvg(
  model: WinCardRenderModel,
  options?: BuildWinCardSvgOptions
): string {
  const accent =
    model.tone === "loss"
      ? {
          primary: "#ff7b90",
          secondary: "#ff4d6d",
          glow: "rgba(255,90,118,0.35)",
          glowOuter: "rgba(255,70,100,0.12)",
          soft: "rgba(255,111,135,0.14)",
          gradient1: "#ff4d6d",
          gradient2: "#ff7b90",
          gradient3: "#ffb3c1",
        }
      : model.tone === "gain"
        ? {
            primary: "#a9ff34",
            secondary: "#41e8cf",
            glow: "rgba(92,255,144,0.35)",
            glowOuter: "rgba(65,232,207,0.12)",
            soft: "rgba(110,255,120,0.14)",
            gradient1: "#5BDF14",
            gradient2: "#a9ff34",
            gradient3: "#41e8cf",
          }
        : {
            primary: "#d6dde8",
            secondary: "#78dcea",
            glow: "rgba(120,220,234,0.22)",
            glowOuter: "rgba(120,220,234,0.08)",
            soft: "rgba(214,221,232,0.12)",
            gradient1: "#78dcea",
            gradient2: "#d6dde8",
            gradient3: "#b8c4d0",
          };

  const metricCards = model.metrics.slice(0, 4);
  const snapshotCards = model.snapshots.slice(0, 3);
  const summaryItems = model.summaryItems.slice(0, 4);
  const noteLines = wrapText(model.noteText, 50, 4);
  const statusLines = wrapText(model.statusDetail, 28, 2);
  const tokenSecondary = wrapText(model.tokenSecondary, 42, 2);
  const authorName = clampText(model.authorName, 20);
  const footerLabel = clampText(model.footerLabel, 48);
  const pillLabel = clampText(model.resultLabel, 14);

  /* ── Metric cards: 2x2 grid below hero ── */
  const metricRects = metricCards
    .map((metric, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = 64 + col * 272;
      const y = 700 + row * 132;
      const tone = metricToneColors(metric.tone);
      const bgFill = metric.highlight
        ? `fill="url(#metricHighlight)"`
        : `fill="rgba(255,255,255,0.035)"`;
      const borderColor = metric.highlight ? "rgba(169,255,52,0.32)" : tone.border;
      return `
        <g transform="translate(${x},${y})">
          <rect width="252" height="116" rx="20" ${bgFill} stroke="${borderColor}" stroke-width="1.5" />
          <text x="20" y="30" class="eyebrow">${escapeXml(metric.label)}</text>
          <text x="20" y="68" class="metricValue" fill="${tone.value}">${escapeXml(clampText(metric.value, 14))}</text>
          <text x="20" y="96" class="metricHint">${escapeXml(clampText(metric.hint, 28))}</text>
        </g>
      `;
    })
    .join("");

  /* ── Snapshots: horizontal bars ── */
  const snapshotRects = snapshotCards
    .map((snapshot, index) => {
      const y = 700 + index * 90;
      const ratio = Math.max(0.06, Math.min(1, snapshot.magnitudeRatio || 0));
      const fillWidth = Math.round(200 * ratio);
      const tone = snapshot.positive === null ? "#d6dde8" : snapshot.positive ? "#b8ff73" : "#ff8f9d";
      return `
        <g transform="translate(620,${y})">
          <rect width="516" height="74" rx="18" fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.10)" stroke-width="1" />
          <text x="22" y="28" class="eyebrow">${escapeXml(snapshot.shortLabel)}</text>
          <text x="22" y="56" class="snapshotPercent" fill="${tone}">${escapeXml(snapshot.percentText)}</text>
          <text x="180" y="28" class="snapshotHint">${escapeXml(clampText(snapshot.label, 20))}</text>
          <text x="180" y="56" class="snapshotProfit">${escapeXml(clampText(snapshot.profitText, 20))}</text>
          <rect x="340" y="26" width="154" height="8" rx="4" fill="rgba(255,255,255,0.08)" />
          <rect x="340" y="26" width="${Math.round(154 * ratio)}" height="8" rx="4" fill="${snapshotFill(snapshot)}" />
          <rect x="340" y="44" width="154" height="8" rx="4" fill="rgba(255,255,255,0.04)" />
          <rect x="340" y="44" width="${fillWidth > 154 ? 154 : fillWidth}" height="8" rx="4" fill="${snapshotFill(snapshot)}" opacity="0.4" />
        </g>
      `;
    })
    .join("");

  /* ── Summary items ── */
  const summaryRects = summaryItems
    .map((item, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = 620 + col * 264;
      const y = 986 + row * 88;
      const tone = summaryToneColor(item.tone);
      return `
        <g transform="translate(${x},${y})">
          <rect width="244" height="74" rx="18" fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.10)" stroke-width="1" />
          <text x="18" y="26" class="eyebrow">${escapeXml(item.label)}</text>
          <text x="18" y="52" class="summaryValue" fill="${tone}">${escapeXml(clampText(item.value, 18))}</text>
          <text x="18" y="68" class="summaryHint">${escapeXml(clampText(item.hint, 26))}</text>
        </g>
      `;
    })
    .join("");

  /* ── Logo ── */
  const logoMarkup = options?.logoDataUrl
    ? `<image href="${escapeXml(options.logoDataUrl)}" x="6" y="6" width="48" height="48" preserveAspectRatio="xMidYMid slice" clip-path="inset(0 round 14px)" />`
    : `<rect x="6" y="6" width="48" height="48" rx="14" fill="url(#brandMarkGlow)" />
       <text x="30" y="39" text-anchor="middle" class="brandMarkFallback">P</text>`;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${WIN_CARD_EXPORT_WIDTH}" height="${WIN_CARD_EXPORT_HEIGHT}" viewBox="0 0 ${WIN_CARD_EXPORT_WIDTH} ${WIN_CARD_EXPORT_HEIGHT}" fill="none">
  <defs>
    <!-- Core gradients -->
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1200" y2="1280" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#04080d" />
      <stop offset="0.35" stop-color="#060e18" />
      <stop offset="0.65" stop-color="#050a12" />
      <stop offset="1" stop-color="#020509" />
    </linearGradient>
    <linearGradient id="accentBeam" x1="0" y1="340" x2="1200" y2="340" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${accent.gradient1}" stop-opacity="0" />
      <stop offset="0.25" stop-color="${accent.gradient1}" stop-opacity="0.6" />
      <stop offset="0.5" stop-color="${accent.gradient2}" stop-opacity="0.85" />
      <stop offset="0.75" stop-color="${accent.gradient3}" stop-opacity="0.6" />
      <stop offset="1" stop-color="${accent.gradient3}" stop-opacity="0" />
    </linearGradient>
    <linearGradient id="accentBeamFade" x1="600" y1="290" x2="600" y2="400" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="white" stop-opacity="0" />
      <stop offset="0.4" stop-color="white" stop-opacity="1" />
      <stop offset="0.6" stop-color="white" stop-opacity="1" />
      <stop offset="1" stop-color="white" stop-opacity="0" />
    </linearGradient>
    <linearGradient id="topEdge" x1="0" y1="0" x2="1200" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${accent.gradient1}" stop-opacity="0" />
      <stop offset="0.3" stop-color="${accent.gradient2}" stop-opacity="0.7" />
      <stop offset="0.7" stop-color="${accent.gradient3}" stop-opacity="0.7" />
      <stop offset="1" stop-color="${accent.gradient3}" stop-opacity="0" />
    </linearGradient>
    <linearGradient id="bottomEdge" x1="0" y1="1280" x2="1200" y2="1280" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${accent.gradient3}" stop-opacity="0" />
      <stop offset="0.3" stop-color="${accent.gradient3}" stop-opacity="0.4" />
      <stop offset="0.7" stop-color="${accent.gradient2}" stop-opacity="0.4" />
      <stop offset="1" stop-color="${accent.gradient1}" stop-opacity="0" />
    </linearGradient>
    <linearGradient id="metricHighlight" x1="0" y1="0" x2="252" y2="116" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="rgba(169,255,52,0.14)" />
      <stop offset="1" stop-color="rgba(65,232,207,0.10)" />
    </linearGradient>
    <radialGradient id="heroGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(600 400) rotate(90) scale(300 500)">
      <stop offset="0" stop-color="${accent.glow}" />
      <stop offset="0.5" stop-color="${accent.glowOuter}" />
      <stop offset="1" stop-color="rgba(0,0,0,0)" />
    </radialGradient>
    <radialGradient id="cornerGlowTL" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(0 0) scale(400)">
      <stop offset="0" stop-color="${accent.gradient1}" stop-opacity="0.08" />
      <stop offset="1" stop-color="${accent.gradient1}" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="cornerGlowBR" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1200 1280) scale(400)">
      <stop offset="0" stop-color="${accent.gradient3}" stop-opacity="0.06" />
      <stop offset="1" stop-color="${accent.gradient3}" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="brandMarkGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(30 30) rotate(90) scale(28)">
      <stop offset="0" stop-color="#a9ff34" stop-opacity="0.95" />
      <stop offset="0.65" stop-color="#41e8cf" stop-opacity="0.24" />
      <stop offset="1" stop-color="#41e8cf" stop-opacity="0" />
    </radialGradient>
    <mask id="beamMask">
      <rect x="0" y="290" width="1200" height="110" fill="url(#accentBeamFade)" />
    </mask>
    <clipPath id="cardClip">
      <rect width="1200" height="1280" rx="36" />
    </clipPath>
    <filter id="glowFilter" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="40" />
    </filter>
    <filter id="textGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="18" />
    </filter>
    <style>
      .sans { font-family: Inter, "Segoe UI", Arial, sans-serif; }
      .eyebrow { font: 700 11px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: 0.22em; text-transform: uppercase; fill: rgba(226,232,240,0.58); }
      .brandName { font: 900 28px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: -0.02em; }
      .brandTag { font: 600 10px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: 0.20em; text-transform: uppercase; fill: rgba(226,232,240,0.50); }
      .pillText { font: 800 13px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: 0.20em; text-transform: uppercase; }
      .heroToken { font: 800 52px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: -0.04em; fill: #ffffff; }
      .heroSecondary { font: 500 20px Inter, "Segoe UI", Arial, sans-serif; fill: rgba(226,232,240,0.65); }
      .heroResult { font: 900 120px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: -0.06em; }
      .heroResultSub { font: 700 22px Inter, "Segoe UI", Arial, sans-serif; fill: rgba(226,232,240,0.72); }
      .heroAuthor { font: 700 24px Inter, "Segoe UI", Arial, sans-serif; fill: #ffffff; }
      .heroMeta { font: 600 12px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: 0.16em; text-transform: uppercase; fill: rgba(226,232,240,0.50); }
      .statusTitle { font: 700 18px Inter, "Segoe UI", Arial, sans-serif; fill: rgba(255,255,255,0.85); }
      .statusBody { font: 500 16px Inter, "Segoe UI", Arial, sans-serif; fill: rgba(226,232,240,0.68); }
      .metricValue { font: 800 28px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: -0.03em; }
      .metricHint { font: 500 12px Inter, "Segoe UI", Arial, sans-serif; fill: rgba(226,232,240,0.52); }
      .snapshotPercent { font: 800 24px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: -0.03em; }
      .snapshotHint { font: 500 12px Inter, "Segoe UI", Arial, sans-serif; fill: rgba(226,232,240,0.55); }
      .snapshotProfit { font: 600 14px Inter, "Segoe UI", Arial, sans-serif; fill: rgba(226,232,240,0.72); }
      .summaryValue { font: 800 20px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: -0.02em; }
      .summaryHint { font: 500 11px Inter, "Segoe UI", Arial, sans-serif; fill: rgba(226,232,240,0.50); }
      .noteText { font: 500 22px Inter, "Segoe UI", Arial, sans-serif; line-height: 1.5; fill: rgba(248,250,252,0.90); }
      .footerText { font: 600 13px Inter, "Segoe UI", Arial, sans-serif; fill: rgba(226,232,240,0.56); }
      .brandMarkFallback { font: 900 30px Inter, "Segoe UI", Arial, sans-serif; fill: #061018; }
      .perfLabel { font: 700 13px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: 0.14em; text-transform: uppercase; fill: rgba(226,232,240,0.58); }
      .perfValue { font: 800 22px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: -0.02em; }
    </style>
  </defs>

  <g clip-path="url(#cardClip)">
    <!-- Background -->
    <rect width="1200" height="1280" fill="url(#bgGrad)" />
    <rect width="1200" height="1280" fill="url(#cornerGlowTL)" />
    <rect width="1200" height="1280" fill="url(#cornerGlowBR)" />

    <!-- Grid pattern for texture -->
    <g opacity="0.03" stroke="#ffffff" stroke-width="0.5">
      ${Array.from({ length: 21 }, (_, i) => `<path d="M${60 * i} 0V1280" />`).join("")}
      ${Array.from({ length: 22 }, (_, i) => `<path d="M0 ${60 * i}H1200" />`).join("")}
    </g>

    <!-- Diagonal accent lines -->
    <g opacity="0.04" stroke="${accent.primary}" stroke-width="1">
      <path d="M-200 600L400 0" />
      <path d="M-100 600L500 0" />
      <path d="M800 1280L1400 680" />
      <path d="M900 1280L1500 680" />
    </g>

    <!-- Horizontal accent beam across hero zone -->
    <g mask="url(#beamMask)">
      <rect x="0" y="290" width="1200" height="110" fill="url(#accentBeam)" opacity="0.12" />
    </g>

    <!-- Central hero glow -->
    <ellipse cx="600" cy="380" rx="500" ry="260" fill="url(#heroGlow)" />

    <!-- Top neon edge -->
    <rect x="0" y="0" width="1200" height="3" fill="url(#topEdge)" />
    <!-- Bottom neon edge -->
    <rect x="0" y="1277" width="1200" height="3" fill="url(#bottomEdge)" />

    <!-- ═══════════════ HEADER BAR ═══════════════ -->
    <g transform="translate(64,48)">
      <rect width="60" height="60" rx="16" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.10)" stroke-width="1" />
      ${logoMarkup}
      <text x="78" y="28" class="brandName" fill="#ffffff">PHEW<tspan fill="${accent.primary}">.</tspan><tspan fill="${accent.secondary}">RUN</tspan></text>
      <text x="80" y="48" class="brandTag">Phew Running The Internet</text>
    </g>

    <!-- Result pill badge -->
    <g transform="translate(920,52)">
      <rect width="216" height="52" rx="26" fill="rgba(0,0,0,0.4)" stroke="${accent.primary}" stroke-width="1.5" />
      <rect x="6" y="6" width="204" height="40" rx="20" fill="${accent.soft}" />
      <text x="108" y="33" text-anchor="middle" class="pillText" fill="${accent.primary}">${escapeXml(pillLabel)}</text>
    </g>

    <!-- ═══════════════ HERO: TOKEN + RESULT ═══════════════ -->

    <!-- Token call -->
    <g transform="translate(64,148)">
      <text x="0" y="16" class="eyebrow">Token Call</text>
      <text x="0" y="72" class="heroToken">${escapeXml(clampText(model.tokenPrimary, 20))}</text>
      ${renderTextLines(tokenSecondary, 0, 104, 26, "heroSecondary")}
    </g>

    <!-- Glowing result number — shadow layer -->
    <text x="600" y="370" text-anchor="middle" class="heroResult" fill="${accent.primary}" filter="url(#textGlow)" opacity="0.45">${escapeXml(model.resultText)}</text>
    <!-- Glowing result number — main layer -->
    <text x="600" y="370" text-anchor="middle" class="heroResult" fill="${accent.primary}">${escapeXml(model.resultText)}</text>

    <!-- Status title below result -->
    <text x="600" y="410" text-anchor="middle" class="statusTitle">${escapeXml(model.statusTitle)}</text>
    ${renderTextLines(statusLines, 600, 438, 22, "statusBody")}

    <!-- Performance mini-cards flanking the result -->
    <g transform="translate(64,290)">
      <rect width="180" height="64" rx="16" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
      <text x="16" y="24" class="perfLabel">${escapeXml(model.performanceLabel)}</text>
      <text x="16" y="50" class="perfValue" fill="${accent.primary}">${escapeXml(clampText(model.performanceValue, 14))}</text>
    </g>
    <g transform="translate(956,290)">
      <rect width="180" height="64" rx="16" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
      <text x="16" y="24" class="perfLabel">${escapeXml(model.marketMoveLabel)}</text>
      <text x="16" y="50" class="perfValue" fill="#ffffff">${escapeXml(clampText(model.marketMoveText, 14))}</text>
    </g>

    <!-- ═══════════════ DIVIDER ═══════════════ -->
    <line x1="64" y1="480" x2="1136" y2="480" stroke="rgba(255,255,255,0.06)" stroke-width="1" />

    <!-- ═══════════════ AUTHOR + NOTES ROW ═══════════════ -->
    <g transform="translate(64,506)">
      <!-- Author card -->
      <rect width="520" height="160" rx="22" fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
      <circle cx="50" cy="50" r="28" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.10)" stroke-width="1" />
      <text x="50" y="60" text-anchor="middle" class="heroAuthor" style="font-size:22px">${escapeXml(model.authorInitial)}</text>
      <text x="92" y="44" class="heroAuthor">${escapeXml(authorName)}</text>
      <text x="92" y="66" class="heroMeta">${escapeXml(model.authorMeta)}</text>
      <rect x="92" y="82" width="160" height="28" rx="14" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
      <text x="108" y="101" class="heroMeta" style="fill:rgba(226,232,240,0.72)">${escapeXml(`${model.authorLevelLabel} ${model.authorLevelText}`)}</text>
      <text x="20" y="144" class="footerText">${escapeXml(model.shareIntro)}</text>
    </g>

    <!-- Alpha notes card -->
    <g transform="translate(610,506)">
      <rect width="526" height="160" rx="22" fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
      <text x="22" y="30" class="eyebrow">Alpha Notes</text>
      ${renderTextLines(noteLines, 22, 62, 30, "noteText")}
    </g>

    <!-- ═══════════════ DIVIDER ═══════════════ -->
    <line x1="64" y1="688" x2="1136" y2="688" stroke="rgba(255,255,255,0.06)" stroke-width="1" />

    <!-- ═══════════════ DATA ZONE: METRICS + SNAPSHOTS ═══════════════ -->

    <!-- Section label: Key Metrics -->
    <text x="64" y="680" class="eyebrow">Key Metrics</text>
    ${metricRects}

    <!-- Section label: Snapshot Ladder -->
    <text x="620" y="680" class="eyebrow">Snapshot Ladder</text>
    ${snapshotRects}

    <!-- ═══════════════ SUMMARY ZONE ═══════════════ -->
    ${summaryItems.length > 0 ? `
    <text x="620" y="972" class="eyebrow">Trade Summary</text>
    ${summaryRects}
    ` : ""}

    <!-- ═══════════════ FOOTER ═══════════════ -->
    <g transform="translate(0,1180)">
      <rect x="64" y="0" width="1072" height="72" rx="20" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
      <text x="88" y="30" class="eyebrow">Reference</text>
      <text x="88" y="52" class="footerText">${escapeXml(footerLabel)}</text>
      <text x="800" y="30" class="eyebrow">Post</text>
      <text x="800" y="52" class="footerText">${escapeXml(model.postIdText)}</text>
      <text x="1112" y="44" text-anchor="end" class="brandTag" style="fill:${accent.primary};opacity:0.6">PHEW.RUN</text>
    </g>

    <!-- Card outer border glow -->
    <rect x="0.75" y="0.75" width="1198.5" height="1278.5" rx="35.5" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1.5" />
  </g>
</svg>`.trim();
}

export async function renderSvgToPngBlob(svg: string): Promise<Blob> {
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const objectUrl = URL.createObjectURL(svgBlob);

  try {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Failed to load share card SVG"));
    });
    image.decoding = "async";
    image.src = objectUrl;
    await loaded;

    const canvas = document.createElement("canvas");
    canvas.width = WIN_CARD_EXPORT_WIDTH;
    canvas.height = WIN_CARD_EXPORT_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas context unavailable");
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png", 1);
    });
    if (!blob) {
      throw new Error("Failed to encode PNG");
    }
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
