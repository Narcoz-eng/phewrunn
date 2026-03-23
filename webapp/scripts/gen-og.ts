import { readFileSync, writeFileSync } from 'fs'
import { Resvg } from '@resvg/resvg-js'

const svgPath = new URL('../public/og-image.svg', import.meta.url).pathname
const outPath = new URL('../public/og-base.png', import.meta.url).pathname

const svg = readFileSync(svgPath, 'utf-8')

const resvg = new Resvg(svg, {
  fitTo: { mode: 'original' },
  font: { loadSystemFonts: true },
})

const rendered = resvg.render()
writeFileSync(outPath, rendered.asPng())

console.log('✓ Generated og-base.png (1200×630)')
