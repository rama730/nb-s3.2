#!/usr/bin/env bun
/**
 * Generates PWA icon PNGs from an inline SVG wordmark.
 *
 * Outputs:
 *   public/icon-192.png            — 192×192 app icon (any)
 *   public/icon-512.png            — 512×512 app icon (any)
 *   public/icon-maskable-512.png   — 512×512 maskable icon (80% safe zone)
 *
 * Swap the SVG constants when a real brand mark is ready. Run:
 *   bun run scripts/generate-app-icons.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const BG_START = "#0a0a0a";
const BG_END = "#27272a";
const FG = "#ffffff";

function buildIconSvg(size: number): string {
    const radius = Math.round(size * 0.22);
    const fontSize = Math.round(size * 0.58);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BG_START}"/>
      <stop offset="1" stop-color="${BG_END}"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="url(#g)"/>
  <text
    x="50%"
    y="54%"
    text-anchor="middle"
    dominant-baseline="middle"
    font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif"
    font-weight="800"
    font-size="${fontSize}"
    fill="${FG}"
    letter-spacing="-0.02em"
  >E</text>
</svg>`;
}

function buildMaskableSvg(size: number): string {
    // Maskable icons need a 40% center safe zone — Android clips up to 20% off each edge.
    // Fill the full square with solid bg, then scale the mark to ~60% of canvas centered.
    const fontSize = Math.round(size * 0.4);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BG_START}"/>
      <stop offset="1" stop-color="${BG_END}"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${size}" height="${size}" fill="url(#g)"/>
  <text
    x="50%"
    y="54%"
    text-anchor="middle"
    dominant-baseline="middle"
    font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif"
    font-weight="800"
    font-size="${fontSize}"
    fill="${FG}"
    letter-spacing="-0.02em"
  >E</text>
</svg>`;
}

async function writePng(outPath: string, svg: string, size: number): Promise<void> {
    await mkdir(dirname(outPath), { recursive: true });
    const png = await sharp(Buffer.from(svg))
        .resize(size, size, { fit: "cover" })
        .png({ compressionLevel: 9 })
        .toBuffer();
    await writeFile(outPath, png);
    console.log(`✓ ${outPath} (${(png.byteLength / 1024).toFixed(1)} KB)`);
}

async function main(): Promise<void> {
    const publicDir = resolve(process.cwd(), "public");
    await Promise.all([
        writePng(resolve(publicDir, "icon-192.png"), buildIconSvg(192), 192),
        writePng(resolve(publicDir, "icon-512.png"), buildIconSvg(512), 512),
        writePng(resolve(publicDir, "icon-maskable-512.png"), buildMaskableSvg(512), 512),
    ]);
    console.log("Done. Replace these with real brand assets when ready.");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
