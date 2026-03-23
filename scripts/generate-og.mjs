import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "../webapp/public/og-base.png");

// Embed the runner mark inline (simplified version for OG card)
const runnerMark = `
<g transform="translate(76, 155) scale(1.35)">
  <defs>
    <radialGradient id="glowL2" cx="46" cy="66" r="42" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#9BFF37" stop-opacity=".85"/>
      <stop offset="1" stop-color="#9BFF37" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowR2" cx="84" cy="66" r="42" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#20E7F4" stop-opacity=".8"/>
      <stop offset="1" stop-color="#20E7F4" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="runL2" x1="22" y1="96" x2="66" y2="30" gradientUnits="userSpaceOnUse">
      <stop stop-color="#5BDF14"/>
      <stop offset=".55" stop-color="#91FF33"/>
      <stop offset="1" stop-color="#D3FF49"/>
    </linearGradient>
    <linearGradient id="runR2" x1="66" y1="98" x2="106" y2="30" gradientUnits="userSpaceOnUse">
      <stop stop-color="#00C9D8"/>
      <stop offset=".58" stop-color="#1FE5F2"/>
      <stop offset="1" stop-color="#5BF4FF"/>
    </linearGradient>
  </defs>
  <circle cx="46" cy="66" r="58" fill="url(#glowL2)"/>
  <circle cx="84" cy="66" r="58" fill="url(#glowR2)"/>
  <g stroke-linecap="round" stroke-linejoin="round">
    <g stroke="url(#runL2)" stroke-width="6.8">
      <path d="M28 46l12-9h16l-9 12"/>
      <path d="M39 48l-10 25 18-14"/>
      <path d="M44 49l16 2-8 10"/>
      <path d="M51 38l8 9"/>
    </g>
    <circle cx="48" cy="29" r="5.8" fill="url(#runL2)" stroke="#1B320A" stroke-width="1.2"/>
    <g stroke="url(#runR2)" stroke-width="6.8">
      <path d="M66 46l10-9 14 8"/>
      <path d="M75 49l16 16"/>
      <path d="M69 51l13 1-8 9"/>
      <path d="M84 39l8 9"/>
      <path d="M72 63l15 8-10 11h18"/>
    </g>
    <circle cx="83" cy="29" r="5.8" fill="url(#runR2)" stroke="#082A31" stroke-width="1.2"/>
  </g>
</g>
`;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="bgGlow" cx="35%" cy="50%" r="55%" gradientUnits="objectBoundingBox">
      <stop offset="0" stop-color="#0d1f0d" stop-opacity="1"/>
      <stop offset="1" stop-color="#080c0e" stop-opacity="1"/>
    </radialGradient>
    <radialGradient id="greenBloom" cx="0.28" cy="0.5" r="0.5" gradientUnits="objectBoundingBox">
      <stop offset="0" stop-color="#3aff1a" stop-opacity="0.08"/>
      <stop offset="1" stop-color="#3aff1a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="tealBloom" cx="0.72" cy="0.5" r="0.4" gradientUnits="objectBoundingBox">
      <stop offset="0" stop-color="#20e7f4" stop-opacity="0.06"/>
      <stop offset="1" stop-color="#20e7f4" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="borderGrad" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox">
      <stop offset="0" stop-color="#3aff1a" stop-opacity="0.35"/>
      <stop offset="0.5" stop-color="#20e7f4" stop-opacity="0.2"/>
      <stop offset="1" stop-color="#3aff1a" stop-opacity="0.1"/>
    </linearGradient>
    <linearGradient id="textGrad" x1="560" y1="0" x2="950" y2="0" gradientUnits="userSpaceOnUse">
      <stop stop-color="#ffffff"/>
      <stop offset="0.55" stop-color="#e8f8f8"/>
      <stop offset="1" stop-color="#b8f0f0"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bgGlow)"/>
  <rect width="1200" height="630" fill="url(#greenBloom)"/>
  <rect width="1200" height="630" fill="url(#tealBloom)"/>

  <!-- Subtle grid lines -->
  <g stroke="#ffffff" stroke-opacity="0.025" stroke-width="1">
    <line x1="0" y1="157" x2="1200" y2="157"/>
    <line x1="0" y1="315" x2="1200" y2="315"/>
    <line x1="0" y1="472" x2="1200" y2="472"/>
    <line x1="300" y1="0" x2="300" y2="630"/>
    <line x1="600" y1="0" x2="600" y2="630"/>
    <line x1="900" y1="0" x2="900" y2="630"/>
  </g>

  <!-- Top border accent line -->
  <rect x="0" y="0" width="1200" height="3" fill="url(#borderGrad)"/>

  <!-- Runner mark (left side) -->
  ${runnerMark}

  <!-- Right side content -->

  <!-- Tagline small -->
  <text x="560" y="198" font-family="Inter,Helvetica,Arial,sans-serif" font-size="15" font-weight="500"
    letter-spacing="0.22em" fill="#7FFF2F" fill-opacity="0.85">
    SOCIALFI · ALPHA · REPUTATION
  </text>

  <!-- Main title: Phew -->
  <text x="556" y="310" font-family="Inter,Helvetica,Arial,sans-serif" font-size="128" font-weight="800"
    fill="#ffffff" fill-opacity="0.97" letter-spacing="-0.02em">
    Phew
  </text>

  <!-- .run in green -->
  <text x="856" y="310" font-family="Inter,Helvetica,Arial,sans-serif" font-size="128" font-weight="800"
    fill="#7FFF2F" letter-spacing="-0.02em">
    .run
  </text>

  <!-- Divider line -->
  <line x1="556" y1="342" x2="1120" y2="342" stroke="#ffffff" stroke-opacity="0.1" stroke-width="1"/>

  <!-- Description -->
  <text x="558" y="390" font-family="Inter,Helvetica,Arial,sans-serif" font-size="24" font-weight="400"
    fill="#c8d8d8" fill-opacity="0.9" letter-spacing="0.01em">
    Build your reputation through crypto calls.
  </text>
  <text x="558" y="422" font-family="Inter,Helvetica,Arial,sans-serif" font-size="24" font-weight="400"
    fill="#c8d8d8" fill-opacity="0.9">
    Track accuracy. Climb the ranks.
  </text>

  <!-- Stat pills -->
  <rect x="558" y="455" width="148" height="38" rx="19" fill="#ffffff" fill-opacity="0.05" stroke="#3aff1a" stroke-opacity="0.3" stroke-width="1"/>
  <text x="632" y="479" font-family="Inter,Helvetica,Arial,sans-serif" font-size="13" font-weight="600"
    fill="#7FFF2F" text-anchor="middle" letter-spacing="0.04em">VERIFY ALPHA</text>

  <rect x="718" y="455" width="148" height="38" rx="19" fill="#ffffff" fill-opacity="0.05" stroke="#20e7f4" stroke-opacity="0.3" stroke-width="1"/>
  <text x="792" y="479" font-family="Inter,Helvetica,Arial,sans-serif" font-size="13" font-weight="600"
    fill="#20e7f4" text-anchor="middle" letter-spacing="0.04em">EARN LEVEL 10</text>

  <rect x="878" y="455" width="148" height="38" rx="19" fill="#ffffff" fill-opacity="0.05" stroke="#7FFF2F" stroke-opacity="0.2" stroke-width="1"/>
  <text x="952" y="479" font-family="Inter,Helvetica,Arial,sans-serif" font-size="13" font-weight="600"
    fill="#c8d8d8" text-anchor="middle" letter-spacing="0.04em">INVITE ONLY</text>

  <!-- Bottom domain -->
  <text x="558" y="575" font-family="Inter,Helvetica,Arial,sans-serif" font-size="18" font-weight="500"
    fill="#ffffff" fill-opacity="0.35" letter-spacing="0.12em">
    PHEW.RUN
  </text>

  <!-- Corner accent dots -->
  <circle cx="40" cy="40" r="3" fill="#3aff1a" fill-opacity="0.4"/>
  <circle cx="1160" cy="590" r="3" fill="#20e7f4" fill-opacity="0.4"/>
  <circle cx="1160" cy="40" r="3" fill="#20e7f4" fill-opacity="0.2"/>
  <circle cx="40" cy="590" r="3" fill="#3aff1a" fill-opacity="0.2"/>
</svg>`;

const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: 1200 },
  font: { loadSystemFonts: true },
});

const pngData = resvg.render();
const pngBuffer = pngData.asPng();
writeFileSync(outPath, pngBuffer);
console.log(`✓ OG image generated: ${outPath} (${Math.round(pngBuffer.length / 1024)}KB)`);
