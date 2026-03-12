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
    return { value: "#b8ff73", border: "rgba(169,255,52,0.25)" };
  }
  if (tone === "loss") {
    return { value: "#ff8f9d", border: "rgba(255,121,143,0.24)" };
  }
  return { value: "#f8fafc", border: "rgba(255,255,255,0.12)" };
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
          glow: "rgba(255,90,118,0.22)",
          soft: "rgba(255,111,135,0.12)",
        }
      : model.tone === "gain"
        ? {
            primary: "#a9ff34",
            secondary: "#41e8cf",
            glow: "rgba(92,255,144,0.24)",
            soft: "rgba(110,255,120,0.12)",
          }
        : {
            primary: "#d6dde8",
            secondary: "#78dcea",
            glow: "rgba(120,220,234,0.16)",
            soft: "rgba(214,221,232,0.1)",
          };

  const metricCards = model.metrics.slice(0, 4);
  const snapshotCards = model.snapshots.slice(0, 3);
  const summaryItems = model.summaryItems.slice(0, 4);
  const noteLines = wrapText(model.noteText, 42, 6);
  const introLines = wrapText(model.shareIntro, 48, 2);
  const statusLines = wrapText(model.statusDetail, 23, 2);
  const tokenSecondary = wrapText(model.tokenSecondary, 38, 2);
  const authorName = wrapText(model.authorName, 30, 2);
  const footerLabel = clampText(model.footerLabel, 42);
  const pillLabel = clampText(model.resultLabel, 14);

  const metricRects = metricCards
    .map((metric, index) => {
      const x = 80 + index * 260;
      const tone = metricToneColors(metric.tone);
      const fill = metric.highlight
        ? `fill="url(#metricHighlightGradient)"`
        : `fill="rgba(255,255,255,0.04)"`;
      return `
        <g transform="translate(${x},430)">
          <rect width="240" height="142" rx="26" ${fill} stroke="${metric.highlight ? "rgba(169,255,52,0.28)" : tone.border}" />
          <text x="24" y="34" class="eyebrow">${escapeXml(metric.label)}</text>
          ${renderTextLines(wrapText(metric.value, 14, 2), 24, 76, 40, "metricValue")}
          <text x="24" y="118" class="metricHint">${escapeXml(clampText(metric.hint, 24))}</text>
        </g>
      `;
    })
    .join("");

  const snapshotRects = snapshotCards
    .map((snapshot, index) => {
      const x = 650 + index * 152;
      const ratio = Math.max(0.06, Math.min(1, snapshot.magnitudeRatio || 0));
      const fillWidth = Math.round(104 * ratio);
      const tone = snapshot.positive === null ? "#d6dde8" : snapshot.positive ? "#b8ff73" : "#ff8f9d";
      return `
        <g transform="translate(${x},654)">
          <rect width="136" height="150" rx="24" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.1)" />
          <text x="20" y="32" class="eyebrow">${escapeXml(snapshot.shortLabel)}</text>
          <text x="20" y="68" class="snapshotPercent" fill="${tone}">${escapeXml(snapshot.percentText)}</text>
          <text x="20" y="92" class="snapshotHint">${escapeXml(clampText(snapshot.label, 16))}</text>
          <text x="20" y="114" class="snapshotHint">${escapeXml(clampText(snapshot.profitText, 16))}</text>
          <rect x="20" y="126" width="104" height="8" rx="4" fill="rgba(255,255,255,0.08)" />
          <rect x="20" y="126" width="${fillWidth}" height="8" rx="4" fill="${snapshotFill(snapshot)}" />
        </g>
      `;
    })
    .join("");

  const summaryRects = summaryItems
    .map((item, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = 650 + column * 228;
      const y = 844 + row * 104;
      const tone = summaryToneColor(item.tone);
      return `
        <g transform="translate(${x},${y})">
          <rect width="208" height="84" rx="22" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.1)" />
          <text x="20" y="28" class="eyebrow">${escapeXml(item.label)}</text>
          <text x="20" y="54" class="summaryValue" fill="${tone}">${escapeXml(clampText(item.value, 18))}</text>
          <text x="20" y="72" class="summaryHint">${escapeXml(clampText(item.hint, 24))}</text>
        </g>
      `;
    })
    .join("");

  const logoMarkup = options?.logoDataUrl
    ? `
      <rect x="82" y="80" width="64" height="64" rx="18" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" />
      <image href="${escapeXml(options.logoDataUrl)}" x="86" y="84" width="56" height="56" preserveAspectRatio="xMidYMid slice" />
    `
    : `
      <rect x="82" y="80" width="64" height="64" rx="18" fill="url(#brandMarkGlow)" stroke="rgba(255,255,255,0.1)" />
      <text x="114" y="121" text-anchor="middle" class="brandMarkFallback">P</text>
    `;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${WIN_CARD_EXPORT_WIDTH}" height="${WIN_CARD_EXPORT_HEIGHT}" viewBox="0 0 ${WIN_CARD_EXPORT_WIDTH} ${WIN_CARD_EXPORT_HEIGHT}" fill="none">
  <defs>
    <linearGradient id="frameGradient" x1="80" y1="70" x2="1100" y2="1180" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="rgba(169,255,52,0.28)" />
      <stop offset="0.4" stop-color="rgba(65,232,207,0.18)" />
      <stop offset="1" stop-color="rgba(255,255,255,0.08)" />
    </linearGradient>
    <linearGradient id="heroGradient" x1="80" y1="160" x2="1120" y2="1020" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#071019" />
      <stop offset="0.55" stop-color="#08141f" />
      <stop offset="1" stop-color="#050b13" />
    </linearGradient>
    <linearGradient id="metricHighlightGradient" x1="0" y1="0" x2="240" y2="142" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="rgba(169,255,52,0.16)" />
      <stop offset="1" stop-color="rgba(65,232,207,0.12)" />
    </linearGradient>
    <radialGradient id="brandMarkGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(114 112) rotate(90) scale(36)">
      <stop offset="0" stop-color="#a9ff34" stop-opacity="0.95" />
      <stop offset="0.65" stop-color="#41e8cf" stop-opacity="0.24" />
      <stop offset="1" stop-color="#41e8cf" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="heroGlowLeft" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(220 220) rotate(90) scale(360)">
      <stop offset="0" stop-color="${accent.glow}" />
      <stop offset="1" stop-color="rgba(0,0,0,0)" />
    </radialGradient>
    <radialGradient id="heroGlowRight" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1020 170) rotate(90) scale(300)">
      <stop offset="0" stop-color="rgba(65,232,207,0.16)" />
      <stop offset="1" stop-color="rgba(0,0,0,0)" />
    </radialGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="20" flood-color="#020617" flood-opacity="0.5" />
    </filter>
    <style>
      .sans { font-family: Inter, "Segoe UI", Arial, sans-serif; }
      .eyebrow { font: 700 12px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: 0.24em; text-transform: uppercase; fill: rgba(226,232,240,0.72); }
      .body { font: 500 22px Inter, "Segoe UI", Arial, sans-serif; fill: rgba(226,232,240,0.86); }
      .brandName { font: 900 34px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: -0.03em; }
      .brandTag { font: 600 12px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: 0.18em; text-transform: uppercase; fill: rgba(226,232,240,0.62); }
      .pillText { font: 800 16px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: 0.16em; text-transform: uppercase; fill: #f8fafc; }
      .heroToken { font: 800 60px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: -0.04em; fill: #ffffff; }
      .heroSecondary { font: 500 24px Inter, "Segoe UI", Arial, sans-serif; fill: rgba(226,232,240,0.72); }
      .heroAuthor { font: 700 30px Inter, "Segoe UI", Arial, sans-serif; fill: #ffffff; }
      .heroMeta { font: 600 14px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: 0.18em; text-transform: uppercase; fill: rgba(226,232,240,0.56); }
      .heroResult { font: 900 96px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: -0.06em; }
      .heroStatusTitle { font: 700 22px Inter, "Segoe UI", Arial, sans-serif; fill: #ffffff; }
      .heroStatusBody { font: 500 18px Inter, "Segoe UI", Arial, sans-serif; fill: rgba(226,232,240,0.78); }
      .metricValue { font: 800 36px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: -0.04em; fill: #ffffff; }
      .metricHint { font: 500 14px Inter, "Segoe UI", Arial, sans-serif; fill: rgba(226,232,240,0.66); }
      .snapshotPercent { font: 800 30px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: -0.04em; }
      .snapshotHint { font: 500 13px Inter, "Segoe UI", Arial, sans-serif; fill: rgba(226,232,240,0.66); }
      .summaryValue { font: 800 24px Inter, "Segoe UI", Arial, sans-serif; letter-spacing: -0.03em; }
      .summaryHint { font: 500 13px Inter, "Segoe UI", Arial, sans-serif; fill: rgba(226,232,240,0.66); }
      .noteText { font: 500 28px Inter, "Segoe UI", Arial, sans-serif; line-height: 1.45; fill: rgba(248,250,252,0.95); }
      .footerText { font: 600 16px Inter, "Segoe UI", Arial, sans-serif; fill: rgba(226,232,240,0.72); }
      .brandMarkFallback { font: 900 36px Inter, "Segoe UI", Arial, sans-serif; fill: #061018; }
    </style>
  </defs>

  <rect width="${WIN_CARD_EXPORT_WIDTH}" height="${WIN_CARD_EXPORT_HEIGHT}" rx="42" fill="#030712" />
  <rect x="40" y="40" width="1120" height="1200" rx="42" fill="url(#heroGradient)" stroke="url(#frameGradient)" />
  <rect x="40" y="40" width="1120" height="1200" rx="42" fill="url(#heroGlowLeft)" />
  <rect x="40" y="40" width="1120" height="1200" rx="42" fill="url(#heroGlowRight)" />

  <g opacity="0.08">
    <path d="M80 236H1120" stroke="#ffffff" />
    <path d="M80 602H1120" stroke="#ffffff" />
    <path d="M80 1038H1120" stroke="#ffffff" />
    <path d="M646 620V1038" stroke="#ffffff" />
  </g>

  <g filter="url(#softShadow)">
    ${logoMarkup}
  </g>
  <text x="164" y="108" class="brandName" fill="#ffffff">PHEW<tspan fill="${accent.primary}">.</tspan><tspan fill="${accent.secondary}">RUN</tspan></text>
  <text x="166" y="130" class="brandTag">Phew Running The Internet</text>

  <g transform="translate(904,80)">
    <rect width="216" height="60" rx="30" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.12)" />
    <rect x="8" y="8" width="200" height="44" rx="22" fill="${accent.soft}" />
    <text x="108" y="39" text-anchor="middle" class="pillText">${escapeXml(pillLabel)}</text>
  </g>

  <g transform="translate(80,170)">
    <rect width="600" height="210" rx="30" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.1)" />
    <circle cx="62" cy="66" r="34" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.08)" />
    <text x="62" y="78" text-anchor="middle" class="heroAuthor">${escapeXml(model.authorInitial)}</text>
    ${renderTextLines(authorName, 118, 66, 34, "heroAuthor")}
    <text x="118" y="108" class="heroMeta">${escapeXml(model.authorMeta)}</text>
    <rect x="118" y="126" width="184" height="34" rx="17" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.08)" />
    <text x="138" y="148" class="body">${escapeXml(`${model.authorLevelLabel} ${model.authorLevelText}`)}</text>
    <text x="36" y="198" class="eyebrow">Token Call</text>
    <text x="36" y="250" class="heroToken">${escapeXml(clampText(model.tokenPrimary, 18))}</text>
    ${renderTextLines(tokenSecondary, 36, 286, 28, "heroSecondary")}
  </g>

  <g transform="translate(710,170)">
    <rect width="410" height="210" rx="30" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.1)" />
    <text x="34" y="44" class="eyebrow">${escapeXml(model.statusTitle)}</text>
    <text x="34" y="134" class="heroResult" fill="${accent.primary}">${escapeXml(model.resultText)}</text>
    ${renderTextLines(statusLines, 34, 168, 24, "heroStatusBody")}
    <g transform="translate(274,34)">
      <rect width="102" height="54" rx="18" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)" />
      <text x="18" y="23" class="eyebrow">${escapeXml(model.performanceLabel)}</text>
      <text x="18" y="42" class="summaryValue" fill="${accent.primary}">${escapeXml(clampText(model.performanceValue, 12))}</text>
    </g>
    <g transform="translate(274,104)">
      <rect width="102" height="54" rx="18" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)" />
      <text x="18" y="23" class="eyebrow">${escapeXml(model.marketMoveLabel)}</text>
      <text x="18" y="42" class="summaryValue" fill="#ffffff">${escapeXml(clampText(model.marketMoveText, 14))}</text>
    </g>
  </g>

  <g transform="translate(80,612)">
    <rect width="540" height="364" rx="30" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.1)" />
    <text x="34" y="42" class="eyebrow">Alpha Notes</text>
    ${renderTextLines(noteLines, 34, 94, 38, "noteText")}
    <rect x="34" y="300" width="472" height="38" rx="19" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" />
    ${renderTextLines(introLines, 52, 324, 20, "footerText")}
  </g>

  <g transform="translate(650,612)">
    <rect width="470" height="220" rx="30" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.1)" />
    <text x="28" y="42" class="eyebrow">Snapshot Ladder</text>
    ${snapshotRects}
  </g>

  <g transform="translate(650,844)">
    <rect width="470" height="184" rx="30" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.1)" />
    <text x="28" y="42" class="eyebrow">Trade Summary</text>
    ${summaryRects}
  </g>

  ${metricRects}

  <g transform="translate(80,1080)">
    <rect width="1040" height="104" rx="28" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.1)" />
    <text x="34" y="48" class="eyebrow">Reference</text>
    <text x="34" y="76" class="footerText">${escapeXml(footerLabel)}</text>
    <text x="760" y="48" class="eyebrow">Post</text>
    <text x="760" y="76" class="footerText">${escapeXml(model.postIdText)}</text>
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
