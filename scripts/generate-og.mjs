import { Resvg } from "@resvg/resvg-js";
import { writeFileSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "../webapp/public/og-base.png");

// Load logo PNG and encode as base64
const icoPath = join(__dirname, "../webapp/public/favicon.ico");
const ico = readFileSync(icoPath);
let pngStart = -1;
for (let i = 0; i < ico.length - 4; i++) {
  if (ico[i] === 0x89 && ico[i+1] === 0x50 && ico[i+2] === 0x4E && ico[i+3] === 0x47) {
    pngStart = i;
    break;
  }
}
const logoPngB64 = pngStart >= 0
  ? ico.slice(pngStart).toString("base64")
  : null;
const logoDataUri = logoPngB64 ? `data:image/png;base64,${logoPngB64}` : null;

// Logo element — centered on left half, large
const logoElement = logoDataUri
  ? `<image href="${logoDataUri}" x="76" y="155" width="220" height="220" preserveAspectRatio="xMidYMid meet"/>`
  : `<text x="186" y="290" font-family="Inter,Helvetica,Arial,sans-serif" font-size="80" font-weight="800" fill="#7FFF2F" text-anchor="middle">P</text>`;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="bgGlow" cx="35%" cy="50%" r="55%" gradientUnits="objectBoundingBox">
      <stop offset="0" stop-color="#0d1f0d" stop-opacity="1"/>
      <stop offset="1" stop-color="#080c0e" stop-opacity="1"/>
    </radialGradient>
    <radialGradient id="greenBloom" cx="0.28" cy="0.5" r="0.5" gradientUnits="objectBoundingBox">
      <stop offset="0" stop-color="#3aff1a" stop-opacity="0.10"/>
      <stop offset="1" stop-color="#3aff1a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="tealBloom" cx="0.72" cy="0.5" r="0.4" gradientUnits="objectBoundingBox">
      <stop offset="0" stop-color="#20e7f4" stop-opacity="0.07"/>
      <stop offset="1" stop-color="#20e7f4" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="borderGrad" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox">
      <stop offset="0" stop-color="#3aff1a" stop-opacity="0.4"/>
      <stop offset="0.5" stop-color="#20e7f4" stop-opacity="0.2"/>
      <stop offset="1" stop-color="#3aff1a" stop-opacity="0.1"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bgGlow)"/>
  <rect width="1200" height="630" fill="url(#greenBloom)"/>
  <rect width="1200" height="630" fill="url(#tealBloom)"/>

  <!-- Subtle grid -->
  <g stroke="#ffffff" stroke-opacity="0.025" stroke-width="1">
    <line x1="0" y1="157" x2="1200" y2="157"/>
    <line x1="0" y1="315" x2="1200" y2="315"/>
    <line x1="0" y1="472" x2="1200" y2="472"/>
    <line x1="300" y1="0" x2="300" y2="630"/>
    <line x1="600" y1="0" x2="600" y2="630"/>
    <line x1="900" y1="0" x2="900" y2="630"/>
  </g>

  <!-- Top accent line -->
  <rect x="0" y="0" width="1200" height="3" fill="url(#borderGrad)"/>

  <!-- Vertical divider between logo and text -->
  <line x1="430" y1="80" x2="430" y2="550" stroke="#ffffff" stroke-opacity="0.06" stroke-width="1"/>

  <!-- Logo (actual PNG) centered in left column -->
  ${logoElement}

  <!-- Right side: tagline -->
  <text x="560" y="198" font-family="Inter,Helvetica,Arial,sans-serif" font-size="15" font-weight="500"
    letter-spacing="0.22em" fill="#7FFF2F" fill-opacity="0.85">SOCIALFI · ALPHA · REPUTATION</text>

  <!-- Main title -->
  <text x="556" y="318" font-family="Inter,Helvetica,Arial,sans-serif" font-size="130" font-weight="800"
    fill="#ffffff" fill-opacity="0.97" letter-spacing="-0.02em">Phew</text>
  <text x="864" y="318" font-family="Inter,Helvetica,Arial,sans-serif" font-size="130" font-weight="800"
    fill="#7FFF2F" letter-spacing="-0.02em">.run</text>

  <!-- Divider -->
  <line x1="556" y1="348" x2="1130" y2="348" stroke="#ffffff" stroke-opacity="0.1" stroke-width="1"/>

  <!-- Description -->
  <text x="558" y="396" font-family="Inter,Helvetica,Arial,sans-serif" font-size="24" font-weight="400"
    fill="#c8d8d8" fill-opacity="0.9">Build your reputation through crypto calls.</text>
  <text x="558" y="428" font-family="Inter,Helvetica,Arial,sans-serif" font-size="24" font-weight="400"
    fill="#c8d8d8" fill-opacity="0.75">Track accuracy. Climb the ranks. Invite only.</text>

  <!-- Stat pills -->
  <rect x="558" y="460" width="148" height="36" rx="18" fill="#ffffff" fill-opacity="0.05" stroke="#3aff1a" stroke-opacity="0.35" stroke-width="1"/>
  <text x="632" y="483" font-family="Inter,Helvetica,Arial,sans-serif" font-size="12" font-weight="600"
    fill="#7FFF2F" text-anchor="middle" letter-spacing="0.05em">VERIFY ALPHA</text>

  <rect x="720" y="460" width="152" height="36" rx="18" fill="#ffffff" fill-opacity="0.05" stroke="#20e7f4" stroke-opacity="0.35" stroke-width="1"/>
  <text x="796" y="483" font-family="Inter,Helvetica,Arial,sans-serif" font-size="12" font-weight="600"
    fill="#20e7f4" text-anchor="middle" letter-spacing="0.05em">EARN LEVEL 10</text>

  <rect x="886" y="460" width="142" height="36" rx="18" fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.15" stroke-width="1"/>
  <text x="957" y="483" font-family="Inter,Helvetica,Arial,sans-serif" font-size="12" font-weight="600"
    fill="#c8d8d8" text-anchor="middle" letter-spacing="0.05em">INVITE ONLY</text>

  <!-- Domain -->
  <text x="558" y="578" font-family="Inter,Helvetica,Arial,sans-serif" font-size="18" font-weight="500"
    fill="#ffffff" fill-opacity="0.3" letter-spacing="0.14em">PHEW.RUN</text>

  <!-- Corner dots -->
  <circle cx="40" cy="40" r="3" fill="#3aff1a" fill-opacity="0.4"/>
  <circle cx="1160" cy="590" r="3" fill="#20e7f4" fill-opacity="0.4"/>
</svg>`;

const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: 1200 },
  font: { loadSystemFonts: true },
});

const pngData = resvg.render();
const pngBuffer = pngData.asPng();
writeFileSync(outPath, pngBuffer);
console.log(`✓ OG image generated: ${outPath} (${Math.round(pngBuffer.length / 1024)}KB)`);
