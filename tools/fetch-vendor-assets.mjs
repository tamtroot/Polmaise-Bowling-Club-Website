import { mkdir, readFile, writeFile } from "node:fs/promises";
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

/*
 * Stage 16: the navigation's first paint.
 *
 * Stage 11 scaled each platform's own sans to Open Sans' advance widths so the
 * header navigation would not re-flow when the web font arrives. That works on
 * Windows (measured: worst movement 2.70px against the 3px budget) but the CI
 * measurements for the Linux runner showed the *same* calibration is not
 * metric-stable there: the navigation still drifted ~14px, and the per-label
 * corrections implied by the CI numbers range from -1.7% to +4.1%, which no
 * single `size-adjust` can absorb. The local faces stay (they are still the best
 * available second tier for every other `--font-ui` surface), but the
 * navigation itself no longer depends on how the platform rasterises a system
 * font: it paints with the *same* Open Sans instance it settles in, subsetted to
 * the label glyphs and inlined as a data URI so it is available before the first
 * layout on every platform.
 *
 * The glyphs come from the header template itself, so a label change cannot
 * leave a character uncovered without failing the navigation guard.
 */
const NAV_TEMPLATE = "_includes/header.njk";
const NAV_SUBSET_FAMILY = "Open Sans Nav";
const NAV_SUBSET_WEIGHT = 600;

/** The navigation labels as they appear in the header template. */
async function readNavLabels() {
  const template = await readFile(path.join(root, NAV_TEMPLATE), "utf8");
  const nav = /<nav\b[\s\S]*?<\/nav>/i.exec(template)?.[0] ?? "";
  const labels = [...nav.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => match[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim())
    .filter(Boolean);
  if (labels.length === 0) {
    throw new Error(`no navigation labels found in ${NAV_TEMPLATE}`);
  }
  return labels;
}

/**
 * Downloads the navigation subset and returns it as an inline @font-face.
 *
 * A data URI is the point: a separate file would race the web font it stands in
 * for, which is exactly the re-flow this face exists to prevent.
 */
async function buildNavigationSubsetFace() {
  const labels = await readNavLabels();
  const characters = [...new Set(labels.join(" ").split(""))].sort().join("");
  const url =
    "https://fonts.googleapis.com/css2" +
    `?family=Open+Sans:wght@${NAV_SUBSET_WEIGHT}` +
    `&text=${encodeURIComponent(characters)}&display=swap`;
  const response = await fetch(url, { headers: { "User-Agent": CHROME_USER_AGENT } });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for the navigation subset`);
  }
  const css = await response.text();
  const fontUrl = css.match(/url\((https:[^)]+)\)/i)?.[1];
  const unicodeRange = css.match(/unicode-range:\s*([^;]+);/i)?.[1].trim();
  if (!fontUrl || !unicodeRange) {
    throw new Error("the navigation subset response had no font url or unicode-range");
  }
  const fontResponse = await fetch(fontUrl, { headers: { "User-Agent": CHROME_USER_AGENT } });
  if (!fontResponse.ok) {
    throw new Error(`${fontResponse.status} ${fontResponse.statusText} for the navigation subset`);
  }
  const data = Buffer.from(await fontResponse.arrayBuffer());
  console.log(
    `  ${String(data.length).padStart(8)} bytes  navigation subset inlined into fonts/fonts.css ` +
      `(${labels.length} labels, ${characters.length} glyphs)`,
  );
  return (
    `/* Navigation first paint: the same Open Sans instance the navigation settles\n` +
    `   in, subsetted to the header labels and inlined so it is available before the\n` +
    `   first layout on every platform (a separate file would race the web font).\n` +
    `   Regenerated by tools/fetch-vendor-assets.mjs from ${NAV_TEMPLATE}. */\n` +
    `@font-face {\n` +
    `  font-family: '${NAV_SUBSET_FAMILY}';\n` +
    `  font-style: normal;\n` +
    `  font-weight: ${NAV_SUBSET_WEIGHT};\n` +
    `  font-display: block;\n` +
    `  src: url(data:font/woff2;base64,${data.toString("base64")}) format('woff2');\n` +
    `  unicode-range: ${unicodeRange};\n` +
    `}`
  );
}

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

  const navigationFace = await buildNavigationSubsetFace();
  const header = `/* Self-hosted web fonts (Merriweather, Open Sans, Playfair Display).\n   Regenerate with: node tools/fetch-vendor-assets.mjs */\n\n`;
  const stylesheet = `${header}${kept.join("\n\n")}\n\n${navigationFace}\n`;
  await writeFile(path.join(vendorRoot, "fonts/fonts.css"), stylesheet, "utf8");
  console.log(`  ${String(Buffer.byteLength(stylesheet)).padStart(8)} bytes  fonts/fonts.css`);
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
