/**
 * Genera le icone della web app "MaintAI Visore XR" installabile sul Meta Quest.
 *
 * L'app XR è un'installazione separata da quella principale (manifest e id
 * diversi): serve un'icona riconoscibile nella libreria del visore, altrimenti
 * le due voci sono indistinguibili.
 *
 * Uso:  node scripts/generate_xr_icons.mjs
 * Le PNG prodotte vanno committate: il build di Vercel non rigenera le icone.
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "frontend", "public", "icons");

// sharp arriva con le dipendenze del frontend (è una optional dep di Next): va
// risolto da lì, non dalla cartella scripts/.
const require = createRequire(join(root, "frontend", "package.json"));
const sharp = require("sharp");

/** Visore stilizzato sul fondo scuro del design system (#0a0f1e / verde #22c55e). */
const svg = (padding) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#020617"/>
    </linearGradient>
    <linearGradient id="visor" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#22c55e"/>
      <stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${padding > 0 ? 0 : 96}" fill="url(#bg)"/>
  <g transform="translate(0, ${padding > 0 ? 8 : 0}) scale(${padding > 0 ? 0.78 : 1}) translate(${padding > 0 ? 56 : 0}, ${padding > 0 ? 56 : 0})">
    <rect x="72" y="176" width="368" height="160" rx="56" fill="url(#visor)"/>
    <path d="M256 336c-26 0-30-44-56-44s-38 28-38 28h188s-12-28-38-28-30 44-56 44z" fill="#020617" opacity="0.55"/>
    <circle cx="168" cy="252" r="34" fill="#020617" opacity="0.75"/>
    <circle cx="344" cy="252" r="34" fill="#020617" opacity="0.75"/>
    <rect x="140" y="120" width="232" height="26" rx="13" fill="#e2e8f0" opacity="0.28"/>
  </g>
</svg>`;

async function main() {
  await mkdir(outDir, { recursive: true });

  const targets = [
    { file: "xr-icon-192.png", size: 192, maskable: false },
    { file: "xr-icon-512.png", size: 512, maskable: false },
    { file: "xr-maskable-192.png", size: 192, maskable: true },
    { file: "xr-maskable-512.png", size: 512, maskable: true },
  ];

  for (const { file, size, maskable } of targets) {
    const buffer = await sharp(Buffer.from(svg(maskable ? 1 : 0)))
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toBuffer();
    await writeFile(join(outDir, file), buffer);
    console.log(`[xr-icons] ${file} (${size}x${size}${maskable ? ", maskable" : ""})`);
  }
}

main().catch((err) => {
  console.error("[xr-icons] generazione fallita:", err);
  process.exit(1);
});
