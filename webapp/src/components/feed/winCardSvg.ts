export const WIN_CARD_EXPORT_WIDTH = 1200;
export const WIN_CARD_EXPORT_HEIGHT = 1280;

export type WinCardTone = "gain" | "loss" | "neutral";

export type WinCardMetric = {
  label: string;
  value: string;
  hint: string;
  highlight?: boolean;
  tone?: WinCardTone | "plain";
};

export type WinCardSnapshot = {
  label: string;
  shortLabel: string;
  percentText: string;
  profitText: string;
  positive: boolean | null;
  magnitudeRatio: number;
};

export type WinCardSummaryItem = {
  label: string;
  value: string;
  hint: string;
  tone?: WinCardTone | "plain";
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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapText(value: string, maxCharsPerLine: number, maxLines: number): string[] {
  const source = value.replace(/\s+/g, " ").trim();
  if (!source) return [];

  const words = source.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxCharsPerLine) {
      current = next;
      continue;
    }
    if (current) {
      lines.push(current);
    }
    current = word;
    if (lines.length === maxLines) {
      break;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  if (lines.length > maxLines) {
    return lines.slice(0, maxLines);
  }

  if (
    lines.length === maxLines &&
    words.join(" ").length > lines.join(" ").length &&
    !lines[maxLines - 1].endsWith("...")
  ) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(0, maxCharsPerLine - 3))}...`;
  }

  return lines;
}

function tonePalette(tone: WinCardTone) {
  switch (tone) {
    case "gain":
      return {
        accent: "#9eff4c",
        accentStrong: "#3ee7d4",
        accentSoft: "rgba(126,255,73,0.18)",
        accentBorder: "rgba(126,255,73,0.34)",
        text: "#f5fff9",
        textMuted: "#cde4db",
        value: "#c6ff7a",
        valueSoft: "#dfffc0",
      };
    case "loss":
      return {
        accent: "#ff758b",
        accentStrong: "#ffb166",
        accentSoft: "rgba(255,117,139,0.18)",
        accentBorder: "rgba(255,117,139,0.34)",
        text: "#fff6f7",
        textMuted: "#ecd6d9",
        value: "#ff9cac",
        valueSoft: "#ffd4d9",
      };
    default:
      return {
        accent: "#9fb4d0",
        accentStrong: "#d9e2ec",
        accentSoft: "rgba(159,180,208,0.16)",
        accentBorder: "rgba(159,180,208,0.28)",
        text: "#f4f7fb",
        textMuted: "#ced8e7",
        value: "#d6e0ef",
        valueSoft: "#eef4fb",
      };
  }
}

function metricToneColor(tone: WinCardMetric["tone"], palette: ReturnType<typeof tonePalette>) {
  if (tone === "gain") return "#b9ff7e";
  if (tone === "loss") return "#ff9dac";
  return palette.valueSoft;
}

function summaryToneColor(tone: WinCardSummaryItem["tone"], palette: ReturnType<typeof tonePalette>) {
  if (tone === "gain") return "#b9ff7e";
  if (tone === "loss") return "#ff9dac";
  return palette.valueSoft;
}

function snapshotBarColor(positive: boolean | null, palette: ReturnType<typeof tonePalette>) {
  if (positive === null) return "#8091a7";
  return positive ? palette.accent : "#ff8fa3";
}

export function buildWinCardSvg(model: WinCardRenderModel, options?: { logoDataUrl?: string | null }) {
  const palette = tonePalette(model.tone);
  const noteLines = wrapText(model.noteText, 42, 6);
  const introLines = wrapText(model.shareIntro, 46, 2);
  const summaryItems = model.summaryItems.slice(0, 4);
  const summaryRowHeight = 68;
  const summaryBaseY = 902;

  const metricCards = model.metrics.slice(0, 4).map((metric, index) => {
    const x = 72 + index * 264;
    const highlightFill = metric.highlight
      ? `fill="url(#metricHighlight)"`
      : `fill="rgba(255,255,255,0.05)"`;
    const stroke = metric.highlight ? palette.accentBorder : "rgba(255,255,255,0.1)";
    const toneColor = metricToneColor(metric.tone, palette);
    return `
      <g>
        <rect x="${x}" y="596" width="240" height="122" rx="28" ${highlightFill} stroke="${stroke}" />
        <text x="${x + 22}" y="628" fill="rgba(236,242,248,0.62)" font-size="12" font-weight="700" letter-spacing="2.2">
          ${escapeXml(metric.label.toUpperCase())}
        </text>
        <text x="${x + 22}" y="672" fill="${toneColor}" font-size="28" font-weight="800">
          ${escapeXml(metric.value)}
        </text>
        <text x="${x + 22}" y="698" fill="rgba(236,242,248,0.52)" font-size="14" font-weight="500">
          ${escapeXml(metric.hint)}
        </text>
      </g>
    `;
  });

  const snapshotCards = model.snapshots.slice(0, 3).map((snapshot, index) => {
    const y = 882 + index * 106;
    const width = Math.max(30, Math.round(184 * snapshot.magnitudeRatio));
    const toneColor = snapshot.positive === null ? "#d6e0ef" : snapshot.positive ? "#c8ff8c" : "#ffafba";
    return `
      <g>
        <rect x="650" y="${y}" width="228" height="86" rx="24" fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.08)" />
        <text x="674" y="${y + 24}" fill="rgba(236,242,248,0.58)" font-size="12" font-weight="700" letter-spacing="1.8">
          ${escapeXml(snapshot.label.toUpperCase())}
        </text>
        <rect x="674" y="${y + 38}" width="184" height="10" rx="5" fill="rgba(255,255,255,0.08)" />
        <rect x="674" y="${y + 38}" width="${width}" height="10" rx="5" fill="${snapshotBarColor(snapshot.positive, palette)}" />
        <text x="674" y="${y + 70}" fill="${toneColor}" font-size="24" font-weight="800">
          ${escapeXml(snapshot.percentText)}
        </text>
        <text x="858" y="${y + 70}" fill="${toneColor}" font-size="16" font-weight="600" text-anchor="end">
          ${escapeXml(snapshot.profitText)}
        </text>
      </g>
    `;
  });

  const summaryRows = summaryItems.map((item, index) => {
    const y = summaryBaseY + index * summaryRowHeight;
    const toneColor = summaryToneColor(item.tone, palette);
    return `
      <g>
        <rect x="906" y="${y}" width="222" height="54" rx="20" fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.08)" />
        <text x="926" y="${y + 21}" fill="rgba(236,242,248,0.54)" font-size="11" font-weight="700" letter-spacing="1.8">
          ${escapeXml(item.label.toUpperCase())}
        </text>
        <text x="926" y="${y + 42}" fill="${toneColor}" font-size="18" font-weight="700">
          ${escapeXml(item.value)}
        </text>
        <text x="1110" y="${y + 42}" fill="rgba(236,242,248,0.48)" font-size="12" font-weight="500" text-anchor="end">
          ${escapeXml(item.hint)}
        </text>
      </g>
    `;
  });

  const introMarkup = introLines
    .map(
      (line, index) => `
        <text x="94" y="${182 + index * 26}" fill="rgba(241,247,252,0.82)" font-size="18" font-weight="500">
          ${escapeXml(line)}
        </text>
      `
    )
    .join("");

  const noteMarkup = noteLines
    .map(
      (line, index) => `
        <text x="96" y="${914 + index * 30}" fill="#f5f8fb" font-size="20" font-weight="500">
          ${escapeXml(line)}
        </text>
      `
    )
    .join("");

  const logoMarkup = options?.logoDataUrl
    ? `<image href="${options.logoDataUrl}" x="70" y="64" width="318" height="92" preserveAspectRatio="xMinYMin meet" />`
    : `
      <text x="72" y="112" fill="#ffffff" font-size="42" font-weight="800">PHEW</text>
      <text x="218" y="112" fill="url(#brandWord)" font-size="42" font-weight="800">.RUN</text>
    `;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${WIN_CARD_EXPORT_WIDTH}" height="${WIN_CARD_EXPORT_HEIGHT}" viewBox="0 0 ${WIN_CARD_EXPORT_WIDTH} ${WIN_CARD_EXPORT_HEIGHT}" fill="none">
  <defs>
    <linearGradient id="pageBg" x1="40" y1="40" x2="1120" y2="1240" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#071119" />
      <stop offset="0.44" stop-color="#091521" />
      <stop offset="1" stop-color="#04070d" />
    </linearGradient>
    <linearGradient id="panelFill" x1="60" y1="60" x2="1140" y2="1220" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0b1823" />
      <stop offset="0.58" stop-color="#08121b" />
      <stop offset="1" stop-color="#050910" />
    </linearGradient>
    <linearGradient id="brandWord" x1="218" y1="78" x2="334" y2="78" gradientUnits="userSpaceOnUse">
      <stop stop-color="#a9ff34" />
      <stop offset="0.55" stop-color="#76ff44" />
      <stop offset="1" stop-color="#41e8cf" />
    </linearGradient>
    <linearGradient id="accentLine" x1="72" y1="0" x2="1128" y2="0" gradientUnits="userSpaceOnUse">
      <stop stop-color="${palette.accent}" />
      <stop offset="1" stop-color="${palette.accentStrong}" />
    </linearGradient>
    <linearGradient id="metricHighlight" x1="72" y1="596" x2="312" y2="718" gradientUnits="userSpaceOnUse">
      <stop stop-color="${palette.accentSoft}" />
      <stop offset="0.62" stop-color="rgba(255,255,255,0.06)" />
      <stop offset="1" stop-color="rgba(65,232,207,0.12)" />
    </linearGradient>
    <radialGradient id="glowLeft" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(250 320) rotate(90) scale(340 380)">
      <stop offset="0" stop-color="${palette.accentSoft}" />
      <stop offset="0.54" stop-color="rgba(255,255,255,0.04)" />
      <stop offset="1" stop-color="rgba(255,255,255,0)" />
    </radialGradient>
    <radialGradient id="glowRight" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(980 220) rotate(90) scale(320 340)">
      <stop offset="0" stop-color="rgba(65,232,207,0.14)" />
      <stop offset="1" stop-color="rgba(255,255,255,0)" />
    </radialGradient>
  </defs>

  <rect width="${WIN_CARD_EXPORT_WIDTH}" height="${WIN_CARD_EXPORT_HEIGHT}" fill="#050911" />
  <rect width="${WIN_CARD_EXPORT_WIDTH}" height="${WIN_CARD_EXPORT_HEIGHT}" fill="url(#pageBg)" />
  <rect x="0" y="0" width="${WIN_CARD_EXPORT_WIDTH}" height="${WIN_CARD_EXPORT_HEIGHT}" fill="url(#glowLeft)" />
  <rect x="0" y="0" width="${WIN_CARD_EXPORT_WIDTH}" height="${WIN_CARD_EXPORT_HEIGHT}" fill="url(#glowRight)" />

  <g opacity="0.055">
    <path d="M0 104 H1200" stroke="#fff" />
    <path d="M0 208 H1200" stroke="#fff" />
    <path d="M0 312 H1200" stroke="#fff" />
    <path d="M0 416 H1200" stroke="#fff" />
    <path d="M0 520 H1200" stroke="#fff" />
    <path d="M0 624 H1200" stroke="#fff" />
    <path d="M0 728 H1200" stroke="#fff" />
    <path d="M0 832 H1200" stroke="#fff" />
    <path d="M0 936 H1200" stroke="#fff" />
    <path d="M0 1040 H1200" stroke="#fff" />
    <path d="M0 1144 H1200" stroke="#fff" />
    <path d="M80 0 V1280" stroke="#fff" />
    <path d="M200 0 V1280" stroke="#fff" />
    <path d="M320 0 V1280" stroke="#fff" />
    <path d="M440 0 V1280" stroke="#fff" />
    <path d="M560 0 V1280" stroke="#fff" />
    <path d="M680 0 V1280" stroke="#fff" />
    <path d="M800 0 V1280" stroke="#fff" />
    <path d="M920 0 V1280" stroke="#fff" />
    <path d="M1040 0 V1280" stroke="#fff" />
  </g>

  <rect x="40" y="40" width="1120" height="1200" rx="42" fill="url(#panelFill)" stroke="rgba(255,255,255,0.1)" />
  <rect x="72" y="72" width="1056" height="6" rx="3" fill="url(#accentLine)" opacity="0.88" />

  ${logoMarkup}

  <rect x="914" y="72" width="214" height="56" rx="28" fill="${palette.accentSoft}" stroke="${palette.accentBorder}" />
  <text x="1021" y="107" fill="${palette.text}" font-size="16" font-weight="800" text-anchor="middle" letter-spacing="2.8">
    ${escapeXml(model.resultLabel)}
  </text>

  <rect x="72" y="150" width="1056" height="72" rx="28" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.08)" />
  ${introMarkup}

  <rect x="72" y="250" width="630" height="304" rx="36" fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.1)" />
  <circle cx="136" cy="330" r="42" fill="${palette.accentSoft}" stroke="${palette.accentBorder}" />
  <text x="136" y="345" fill="${palette.text}" font-size="34" font-weight="800" text-anchor="middle">
    ${escapeXml(model.authorInitial)}
  </text>
  <text x="198" y="312" fill="${palette.text}" font-size="18" font-weight="600" letter-spacing="2">
    ${escapeXml(model.authorMeta.toUpperCase())}
  </text>
  <text x="198" y="368" fill="${palette.valueSoft}" font-size="58" font-weight="800">
    ${escapeXml(model.tokenPrimary)}
  </text>
  <text x="198" y="404" fill="rgba(236,242,248,0.72)" font-size="22" font-weight="500">
    ${escapeXml(model.tokenSecondary)}
  </text>
  <text x="198" y="444" fill="${palette.text}" font-size="28" font-weight="700">
    ${escapeXml(model.authorName)}
  </text>
  <rect x="198" y="470" width="214" height="42" rx="21" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.08)" />
  <text x="305" y="497" fill="${palette.value}" font-size="16" font-weight="700" text-anchor="middle">
    ${escapeXml(`${model.authorLevelLabel} / ${model.authorLevelText}`)}
  </text>

  <rect x="726" y="250" width="402" height="304" rx="36" fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.1)" />
  <text x="756" y="298" fill="rgba(236,242,248,0.66)" font-size="14" font-weight="700" letter-spacing="2.4">
    ${escapeXml(model.statusTitle.toUpperCase())}
  </text>
  <text x="756" y="398" fill="${palette.value}" font-size="92" font-weight="800">
    ${escapeXml(model.resultText)}
  </text>
  <text x="756" y="434" fill="rgba(236,242,248,0.74)" font-size="24" font-weight="500">
    ${escapeXml(model.statusDetail)}
  </text>

  <rect x="756" y="462" width="160" height="62" rx="22" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.08)" />
  <text x="776" y="488" fill="rgba(236,242,248,0.54)" font-size="11" font-weight="700" letter-spacing="1.8">
    ${escapeXml(model.performanceLabel.toUpperCase())}
  </text>
  <text x="776" y="514" fill="${palette.value}" font-size="24" font-weight="700">
    ${escapeXml(model.performanceValue)}
  </text>

  <rect x="936" y="462" width="162" height="62" rx="22" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.08)" />
  <text x="956" y="488" fill="rgba(236,242,248,0.54)" font-size="11" font-weight="700" letter-spacing="1.8">
    ${escapeXml(model.marketMoveLabel.toUpperCase())}
  </text>
  <text x="956" y="514" fill="${palette.value}" font-size="24" font-weight="700">
    ${escapeXml(model.marketMoveText)}
  </text>

  ${metricCards.join("")}

  <rect x="72" y="792" width="548" height="324" rx="34" fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.09)" />
  <text x="96" y="836" fill="rgba(236,242,248,0.62)" font-size="13" font-weight="700" letter-spacing="2.2">
    ALPHA NOTES
  </text>
  ${noteMarkup}
  <text x="96" y="1082" fill="rgba(236,242,248,0.52)" font-size="14" font-weight="600">
    ${escapeXml(model.postIdText)}
  </text>

  <rect x="650" y="792" width="228" height="324" rx="34" fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.09)" />
  <text x="674" y="836" fill="rgba(236,242,248,0.62)" font-size="13" font-weight="700" letter-spacing="2.2">
    SNAPSHOT LADDER
  </text>
  ${snapshotCards.join("")}

  <rect x="906" y="792" width="222" height="324" rx="34" fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.09)" />
  <text x="926" y="836" fill="rgba(236,242,248,0.62)" font-size="13" font-weight="700" letter-spacing="2.2">
    MARKET READOUT
  </text>
  ${summaryRows.join("")}

  <rect x="72" y="1142" width="1056" height="66" rx="28" fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.08)" />
  <text x="96" y="1183" fill="rgba(236,242,248,0.74)" font-size="16" font-weight="600">
    Generated on PHEW.RUN
  </text>
  <text x="1104" y="1183" fill="rgba(236,242,248,0.74)" font-size="16" font-weight="600" text-anchor="end">
    ${escapeXml(model.footerLabel)}
  </text>
</svg>
  `.trim();
}

export async function renderSvgToPngBlob(svg: string) {
  const image = new Image();
  image.decoding = "sync";

  const svgBlob = new Blob([svg], {
    type: "image/svg+xml;charset=utf-8",
  });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Failed to load win card image"));
      image.src = svgUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = WIN_CARD_EXPORT_WIDTH;
    canvas.height = WIN_CARD_EXPORT_HEIGHT;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Failed to create win card canvas");
    }

    context.drawImage(image, 0, 0, WIN_CARD_EXPORT_WIDTH, WIN_CARD_EXPORT_HEIGHT);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Failed to render win card PNG"));
          return;
        }
        resolve(blob);
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
