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
  authorLevel: number;
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
  avatarDataUrl?: string | null;
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

function getLevelBarColors(level: number): { fill: string; label: string; textColor: string } {
  if (level >= 8) return { fill: "linear-gradient(90deg, #f59e0b, #fbbf24)", label: "Elite", textColor: "#fbbf24" };
  if (level >= 5) return { fill: "linear-gradient(90deg, #94a3b8, #cbd5e1)", label: "Veteran", textColor: "#cbd5e1" };
  if (level >= 4) return { fill: "linear-gradient(90deg, #71717a, #d4d4d8)", label: "Credible", textColor: "#d4d4d8" };
  if (level >= 1) return { fill: "linear-gradient(90deg, #c2410c, #ea580c)", label: "Rising", textColor: "#ea580c" };
  if (level >= -2) return { fill: "linear-gradient(90deg, #dc2626, #f87171)", label: "At Risk", textColor: "#f87171" };
  return { fill: "linear-gradient(90deg, #991b1b, #dc2626)", label: "Liquidated", textColor: "#dc2626" };
}

function getLevelBarFillStops(level: number): { c1: string; c2: string } {
  if (level >= 8) return { c1: "#f59e0b", c2: "#fbbf24" };
  if (level >= 5) return { c1: "#94a3b8", c2: "#cbd5e1" };
  if (level >= 4) return { c1: "#71717a", c2: "#d4d4d8" };
  if (level >= 1) return { c1: "#c2410c", c2: "#ea580c" };
  if (level >= -2) return { c1: "#dc2626", c2: "#f87171" };
  return { c1: "#991b1b", c2: "#dc2626" };
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
  // Strip any residual long unbroken tokens (e.g. partially-matched CAs) before wrapping
  const sanitizedNote = model.noteText.replace(/[A-Za-z0-9]{30,}/g, (m) => `${m.slice(0, 10)}…`);
  const noteLines = wrapText(sanitizedNote, 42, 4);
  const statusLines = wrapText(model.statusDetail, 28, 2);
  const tokenSecondary = wrapText(model.tokenSecondary, 34, 2);
  const authorName = clampText(model.authorName, 20);
  const footerLabel = clampText(model.footerLabel, 48);
  const pillLabel = clampText(model.resultLabel, 14);

  /* ── Split metrics: highlighted (Current MCAP) gets a big callout, rest in row ── */
  const highlightedMetric = metricCards.find((m) => m.highlight) || null;
  const regularMetrics = metricCards.filter((m) => !m.highlight);

  const regularMetricRects = regularMetrics
    .map((metric, index) => {
      const x = 64 + index * 186;
      const tone = metricToneColors(metric.tone);
      return `
        <g transform="translate(${x},700)">
          <rect width="170" height="106" rx="18" fill="rgba(255,255,255,0.035)" stroke="${tone.border}" stroke-width="1" />
          <text x="16" y="26" class="eyebrow">${escapeXml(metric.label)}</text>
          <text x="16" y="60" class="metricValue" fill="${tone.value}">${escapeXml(clampText(metric.value, 14))}</text>
          <text x="16" y="84" class="metricHint">${escapeXml(clampText(metric.hint, 22))}</text>
        </g>
      `;
    })
    .join("");

  /* ── Highlighted Current MCAP callout ── */
  const currentMcapCallout = highlightedMetric
    ? `
    <g transform="translate(64,828)">
      <rect width="524" height="108" rx="22" fill="url(#mcapCalloutBg)" stroke="url(#mcapCalloutBorder)" stroke-width="2" />
      <text x="26" y="30" class="eyebrow" style="fill:${accent.primary};opacity:0.9">${escapeXml(highlightedMetric.label)}</text>
      <text x="26" y="78" class="currentMcapValue" fill="${accent.primary}">${escapeXml(clampText(highlightedMetric.value, 18))}</text>
      <text x="26" y="98" class="metricHint" style="fill:rgba(226,232,240,0.65)">${escapeXml(clampText(highlightedMetric.hint, 32))}</text>
      <text x="498" y="68" text-anchor="end" class="mcapLive" fill="${accent.primary}">LIVE</text>
    </g>`
    : "";

  /* ── Snapshots: horizontal bars ── */
  const snapshotRects = snapshotCards
    .map((snapshot, index) => {
      const y = 700 + index * 80;
      const ratio = Math.max(0.06, Math.min(1, snapshot.magnitudeRatio || 0));
      const tone = snapshot.positive === null ? "#d6dde8" : snapshot.positive ? "#b8ff73" : "#ff8f9d";
      return `
        <g transform="translate(620,${y})">
          <rect width="516" height="66" rx="16" fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.10)" stroke-width="1" />
          <text x="22" y="26" class="eyebrow">${escapeXml(snapshot.shortLabel)}</text>
          <text x="22" y="52" class="snapshotPercent" fill="${tone}">${escapeXml(snapshot.percentText)}</text>
          <text x="180" y="26" class="snapshotHint">${escapeXml(clampText(snapshot.label, 20))}</text>
          <text x="180" y="52" class="snapshotProfit">${escapeXml(clampText(snapshot.profitText, 20))}</text>
          <rect x="350" y="24" width="144" height="8" rx="4" fill="rgba(255,255,255,0.08)" />
          <rect x="350" y="24" width="${Math.round(144 * ratio)}" height="8" rx="4" fill="${snapshotFill(snapshot)}" />
          <rect x="350" y="42" width="144" height="8" rx="4" fill="rgba(255,255,255,0.04)" />
          <rect x="350" y="42" width="${Math.min(144, Math.round(144 * ratio))}" height="8" rx="4" fill="${snapshotFill(snapshot)}" opacity="0.4" />
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
      const y = 960 + row * 84;
      const tone = summaryToneColor(item.tone);
      return `
        <g transform="translate(${x},${y})">
          <rect width="244" height="70" rx="16" fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.10)" stroke-width="1" />
          <text x="16" y="24" class="eyebrow">${escapeXml(item.label)}</text>
          <text x="16" y="48" class="summaryValue" fill="${tone}">${escapeXml(clampText(item.value, 18))}</text>
          <text x="16" y="64" class="summaryHint">${escapeXml(clampText(item.hint, 26))}</text>
        </g>
      `;
    })
    .join("");

  /* ── Logo ── */
  const logoMarkup = options?.logoDataUrl
    ? `<image href="${escapeXml(options.logoDataUrl)}" x="6" y="6" width="48" height="48" preserveAspectRatio="xMidYMid slice" clip-path="inset(0 round 14px)" />`
    : `<rect x="6" y="6" width="48" height="48" rx="14" fill="url(#brandMarkGlow)" />
       <text x="30" y="39" text-anchor="middle" class="brandMarkFallback">P</text>`;

  /* ── Avatar ── */
  const avatarMarkup = options?.avatarDataUrl
    ? `<clipPath id="avatarClip"><circle cx="50" cy="50" r="30" /></clipPath>
       <circle cx="50" cy="50" r="31" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="2" />
       <image href="${escapeXml(options.avatarDataUrl)}" x="20" y="20" width="60" height="60" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)" />`
    : `<circle cx="50" cy="50" r="30" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" stroke-width="1.5" />
       <text x="50" y="60" text-anchor="middle" class="heroAuthor" style="font-size:24px">${escapeXml(model.authorInitial)}</text>`;

  /* ── Level bar (matches profile LevelBar component) ── */
  const levelInfo = getLevelBarColors(model.authorLevel);
  const levelStops = getLevelBarFillStops(model.authorLevel);
  const levelNorm = Math.max(3, ((model.authorLevel - (-5)) / 15) * 100); // -5 to 10 → 0-100
  const levelBarWidth = Math.round((380 * levelNorm) / 100);
  // 15 segments for the bar background (matching LevelBar.tsx)
  const levelSegments = Array.from({ length: 15 }, (_, i) => {
    let segColor = "rgba(220,38,38,0.12)"; // -5 to -1 (red)
    if (i >= 5 && i < 6) segColor = "rgba(234,88,12,0.12)"; // 0 (orange)
    if (i >= 6 && i < 9) segColor = "rgba(234,88,12,0.10)"; // 1-3 (orange)
    if (i >= 9 && i < 10) segColor = "rgba(161,161,170,0.10)"; // 4 (zinc)
    if (i >= 10 && i < 13) segColor = "rgba(148,163,184,0.10)"; // 5-7 (slate)
    if (i >= 13) segColor = "rgba(245,158,11,0.12)"; // 8-10 (amber)
    const segW = Math.floor(380 / 15);
    const segX = i * segW;
    return `<rect x="${segX}" y="0" width="${segW - 1}" height="12" rx="0" fill="${segColor}" />`;
  }).join("");

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
    <linearGradient id="mcapCalloutBg" x1="0" y1="0" x2="524" y2="108" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${accent.gradient1}" stop-opacity="0.14" />
      <stop offset="0.5" stop-color="${accent.gradient2}" stop-opacity="0.08" />
      <stop offset="1" stop-color="${accent.gradient3}" stop-opacity="0.12" />
    </linearGradient>
    <linearGradient id="mcapCalloutBorder" x1="0" y1="0" x2="524" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${accent.gradient1}" stop-opacity="0.45" />
      <stop offset="0.5" stop-color="${accent.gradient2}" stop-opacity="0.55" />
      <stop offset="1" stop-color="${accent.gradient3}" stop-opacity="0.45" />
    </linearGradient>
    <radialGradient id="mcapGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(326 882) scale(300 80)">
      <stop offset="0" stop-color="${accent.glow}" />
      <stop offset="1" stop-color="rgba(0,0,0,0)" />
    </radialGradient>
    <linearGradient id="levelBarFill" x1="0" y1="0" x2="380" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${levelStops.c1}" />
      <stop offset="1" stop-color="${levelStops.c2}" />
    </linearGradient>
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
      .noteText { font: 500 17px Inter, "Segoe UI", Arial, sans-serif; line-height: 1.5; fill: rgba(248,250,252,0.90); }
      .footerText { font: 600 13px Inter, "Segoe UI", Arial, sans-serif; fill: rgba(226,232,240,0.56); }
      .brandMarkFallback { font: 900 30px Inter, "Segoe UI", Arial, sans-serif; fill: #061018; }
      .perfLabel { font: 700 13px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: 0.14em; text-transform: uppercase; fill: rgba(226,232,240,0.58); }
      .perfValue { font: 800 22px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: -0.02em; }
      .currentMcapValue { font: 900 48px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: -0.04em; }
      .mcapLive { font: 800 14px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: 0.20em; text-transform: uppercase; }
      .levelLabel { font: 700 12px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: 0.14em; text-transform: uppercase; }
      .levelValue { font: 800 13px Inter, "Segoe UI", Arial, sans-serif; font-variant-numeric: tabular-nums; }
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
      <!-- Avatar (circular, same as profile) -->
      <g transform="translate(20,16)">
        ${avatarMarkup}
      </g>
      <text x="100" y="42" class="heroAuthor">${escapeXml(authorName)}</text>
      <text x="100" y="62" class="heroMeta">${escapeXml(model.authorMeta)}</text>
      <!-- Level bar (matches profile) -->
      <g transform="translate(100,78)">
        <text x="0" y="0" class="levelLabel" fill="${levelInfo.textColor}">${escapeXml(levelInfo.label)}</text>
        <text x="384" y="0" text-anchor="end" class="levelValue" fill="${levelInfo.textColor}">LVL ${model.authorLevel > 0 ? `+${model.authorLevel}` : model.authorLevel}</text>
        <!-- Segmented track -->
        <g transform="translate(0,8)">
          <rect width="380" height="12" rx="6" fill="rgba(255,255,255,0.06)" />
          <g opacity="0.6">${levelSegments}</g>
          <!-- Fill -->
          <rect width="${levelBarWidth}" height="12" rx="6" fill="url(#levelBarFill)" />
          <!-- Shine -->
          <rect width="${levelBarWidth}" height="6" rx="3" fill="rgba(255,255,255,0.18)" />
          <!-- Center marker at level 0 (1/3 from left) -->
          <rect x="126" y="0" width="1.5" height="12" fill="rgba(255,255,255,0.25)" />
        </g>
      </g>
      <text x="20" y="144" class="footerText">${escapeXml(model.shareIntro)}</text>
    </g>

    <!-- Alpha notes card -->
    <g transform="translate(610,506)">
      <rect width="526" height="160" rx="22" fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
      <text x="22" y="30" class="eyebrow">Alpha Notes</text>
      ${renderTextLines(noteLines, 22, 58, 26, "noteText")}
    </g>

    <!-- ═══════════════ DIVIDER ═══════════════ -->
    <line x1="64" y1="688" x2="1136" y2="688" stroke="rgba(255,255,255,0.06)" stroke-width="1" />

    <!-- ═══════════════ DATA ZONE: METRICS + SNAPSHOTS ═══════════════ -->

    <!-- Section label: Key Metrics -->
    <text x="64" y="686" class="eyebrow">Key Metrics</text>
    ${regularMetricRects}

    <!-- Current MCAP callout with glow -->
    <ellipse cx="326" cy="882" rx="300" ry="70" fill="url(#mcapGlow)" />
    ${currentMcapCallout}

    <!-- Section label: Snapshot Ladder -->
    <text x="620" y="686" class="eyebrow">Snapshot Ladder</text>
    ${snapshotRects}

    <!-- ═══════════════ SUMMARY ZONE ═══════════════ -->
    ${summaryItems.length > 0 ? `
    <text x="620" y="948" class="eyebrow">Trade Summary</text>
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
