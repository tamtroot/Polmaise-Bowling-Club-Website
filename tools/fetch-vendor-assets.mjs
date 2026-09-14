import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Stage 10: keep the site's critical-path assets self-hosted.
 *
 * The site used to load jQuery, Lightbox2, Font Awesome and its web fonts from
 * third-party CDNs on every page. Those requests are render/parser blocking, so
 * a slow CDN left pages unpainted and apparently frozen. This script downloads
 * the exact versions once into `vendor/`, which is copied into the build, so no
 * page depends on a third-party origin any more.
 *
 * Run:  node tools/fetch-vendor-assets.mjs
 */
const root = process.cwd();
const vendorRoot = path.join(root, "vendor");
const CHROME_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const CDNJS = "https://cdnjs.cloudflare.com/ajax/libs";
const DOWNLOADS = [
  {
    url: `${CDNJS}/font-awesome/6.4.2/css/all.min.css`,
    dest: "fontawesome/css/all.min.css",
  },
  {
    url: `${CDNJS}/font-awesome/6.4.2/webfonts/fa-solid-900.woff2`,
    dest: "fontawesome/webfonts/fa-solid-900.woff2",
  },
  {
    url: `${CDNJS}/font-awesome/6.4.2/webfonts/fa-brands-400.woff2`,
    dest: "fontawesome/webfonts/fa-brands-400.woff2",
  },
  {
    url: `${CDNJS}/jquery/3.6.0/jquery.min.js`,
    dest: "jquery/jquery-3.6.0.min.js",
  },
  {
    url: `${CDNJS}/lightbox2/2.11.3/css/lightbox.min.css`,
    // Kept in css/ because the stylesheet references ../images/*.
    dest: "lightbox2/css/lightbox.min.css",
  },
  {
    url: `${CDNJS}/lightbox2/2.11.3/js/lightbox.min.js`,
    dest: "lightbox2/js/lightbox.min.js",
  },
  ...["close.png", "loading.gif", "next.png", "prev.png"].map((name) => ({
    url: `${CDNJS}/lightbox2/2.11.3/images/${name}`,
    dest: `lightbox2/images/${name}`,
  })),
];

const FONT_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&family=Open+Sans:wght@400;600&family=Playfair+Display:wght@400;700;900&display=swap";
// Only the subsets this site can render. The content is UK English: it uses
// Latin-1 characters (£, ×) and General Punctuation (–, —, ’ “ ” •), all of
// which the "latin" subset covers, so latin-ext is not shipped.
const KEPT_SUBSETS = new Set(["latin"]);
// Font Awesome ships regular, solid and brand faces plus v4 compatibility
// mappings. The site only uses solid (fas) and brand (fab) icons, so the other
// faces are dropped — that keeps every url() in the stylesheet resolvable and
// removes ~150 KB of fonts nobody downloads.
const KEPT_FA_FACES = ["fa-solid-900", "fa-brands-400"];

async function download(url, dest, { binary = true } = {}) {
  const response = await fetch(url, { headers: { "User-Agent": CHROME_USER_AGENT } });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  const target = path.join(vendorRoot, dest);
  await mkdir(path.dirname(target), { recursive: true });
  const body = binary
    ? Buffer.from(await response.arrayBuffer())
    : await response.text();
  await writeFile(target, body);
  const bytes = typeof body === "string" ? Buffer.byteLength(body) : body.length;
  console.log(`  ${String(bytes).padStart(8)} bytes  ${dest}`);
  return bytes;
}

/** Trims the Font Awesome stylesheet to the faces the site actually uses. */
async function downloadFontAwesome(dest) {
  const url = `${CDNJS}/font-awesome/6.4.2/css/all.min.css`;
  const response = await fetch(url, { headers: { "User-Agent": CHROME_USER_AGENT } });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  const css = await response.text();
  let removedFaces = 0;
  const trimmed = css.replace(/@font-face\{[^}]*\}/g, (block) => {
    const file = block.match(/url\(\.\.\/webfonts\/([^)]+)\)/)?.[1] ?? "";
    if (!KEPT_FA_FACES.some((face) => file.startsWith(face))) {
      removedFaces += 1;
      return "";
    }
    // Keep only the woff2 source: every browser this site supports reads it,
    // and shipping the .ttf fallbacks would double the download.
    return block.replace(/,url\([^)]*\.ttf\)\s*format\("truetype"\)/g, "");
  });
  const target = path.join(vendorRoot, dest);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, trimmed, "utf8");
  console.log(
    `  ${String(Buffer.byteLength(trimmed)).padStart(8)} bytes  ${dest} (${removedFaces} unused @font-face blocks removed)`,
  );
  return Buffer.byteLength(trimmed);
}

/** Rewrites the Google Fonts stylesheet so every face points at a local file. */
async function fetchFonts() {
  const response = await fetch(FONT_CSS_URL, {
    headers: { "User-Agent": CHROME_USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for the fonts stylesheet`);
  }
  const css = await response.text();
  const blocks = [...css.matchAll(/(?:\/\*\s*([a-z0-9-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g)];
  const kept = [];
  let bytes = 0;
  // Google serves variable fonts, so several weights can point at one file.
  const downloaded = new Map();

  for (const [full, subset, body] of blocks) {
    if (subset && !KEPT_SUBSETS.has(subset)) continue;
    const url = body.match(/url\((https:[^)]+\.woff2)\)/i)?.[1];
    if (!url) continue;
    const family = (body.match(/font-family:\s*'([^']+)'/i)?.[1] ?? "font")
      .toLowerCase()
      .replace(/\s+/g, "-");
    const weight = body.match(/font-weight:\s*(\d+)/i)?.[1] ?? "400";
    const style = (body.match(/font-style:\s*(\w+)/i)?.[1] ?? "normal").toLowerCase();
    const dest = `fonts/files/${family}-${weight}-${style}-${subset ?? "latin"}.woff2`;
    let localDest = downloaded.get(url);
    if (localDest) {
      console.log(`  ${"reused".padStart(8)}          ${localDest} (identical file for ${family} ${weight})`);
    } else {
      localDest = dest;
      bytes += await download(url, localDest);
      downloaded.set(url, localDest);
    }
    kept.push(`/* ${subset ?? "latin"} */\n@font-face {${body.replace(url, `./files/${path.basename(localDest)}`).trimEnd()}\n}`);
  }

  const header = `/* Self-hosted web fonts (Merriweather, Open Sans, Playfair Display).\n   Regenerate with: node tools/fetch-vendor-assets.mjs */\n\n`;
  await writeFile(path.join(vendorRoot, "fonts/fonts.css"), header + kept.join("\n\n") + "\n", "utf8");
  console.log(`  ${String(Buffer.byteLength(header + kept.join("\n"))).padStart(8)} bytes  fonts/fonts.css`);
  return bytes;
}

console.log("Downloading vendor assets into vendor/ …");
let total = 0;
for (const file of DOWNLOADS) {
  if (file.dest.endsWith("fontawesome/css/all.min.css")) {
    total += await downloadFontAwesome(file.dest);
    continue;
  }
  total += await download(file.url, file.dest);
}
total += await fetchFonts();
console.log(`\nSelf-hosted assets: ${(total / 1024).toFixed(1)} KiB`);
