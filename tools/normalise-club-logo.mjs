import { writeFile, rename } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/**
 * Exports the club crest with a transparent background.
 *
 * The archived `Images/club-logo.png` is a circular badge drawn on an opaque
 * white square. Because the square was opaque, the crest appeared as a white
 * box on the night theme, and it was the root cause of the long-standing logo
 * display defect. This tool masks everything outside the badge circle so the
 * crest sits cleanly on any background.
 *
 * The badge is a circle of diameter ~94px centred in the 110px canvas, so the
 * mask uses the badge's own geometry; the canvas size and the crest's position
 * inside it are unchanged, which keeps every existing layout intact.
 *
 * Run:  node tools/normalise-club-logo.mjs [--check]
 */
const root = process.cwd();
const logoPath = path.join(root, "Images", "club-logo.png");
const checkOnly = process.argv.includes("--check");

const metadata = await sharp(logoPath).metadata();
const centre = (metadata.width - 1) / 2;
const radius = 46.8;

const mask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${metadata.width}" height="${metadata.height}">` +
    `<circle cx="${centre}" cy="${centre}" r="${radius}" fill="#ffffff"/>` +
    `</svg>`,
);

const { data, info } = await sharp(logoPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
const cornersOpaque =
  alphaAt(0, 0) > 8 ||
  alphaAt(info.width - 1, 0) > 8 ||
  alphaAt(0, info.height - 1) > 8 ||
  alphaAt(info.width - 1, info.height - 1) > 8;

if (checkOnly) {
  console.log(
    cornersOpaque
      ? "club-logo.png still has an opaque square background"
      : "club-logo.png already has a transparent background",
  );
  process.exit(cornersOpaque ? 1 : 0);
}

if (!cornersOpaque) {
  console.log("club-logo.png already has a transparent background; nothing to do.");
  process.exit(0);
}

const temporaryPath = `${logoPath}.tmp`;
await sharp(logoPath)
  .composite([{ input: mask, blend: "dest-in" }])
  .png({ compressionLevel: 9, palette: true })
  .toFile(temporaryPath);
await rename(temporaryPath, logoPath);

const result = await sharp(logoPath).metadata();
const size = (await sharp(logoPath).toBuffer()).length;
console.log(
  `club-logo.png: ${metadata.width}x${metadata.height} masked to a transparent circle ` +
    `(${result.hasAlpha ? "alpha" : "no alpha"}), ${size} bytes`,
);
