import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const PROJECT_ROOT = process.cwd();
const ORIGINALS_ROOT = path.join(PROJECT_ROOT, "Images");
// Defaults to .cache/images; IMAGE_CACHE_ROOT can move it outside a
// cloud-synced working copy, where generated files can become locked.
const CACHE_ROOT = path.resolve(
  PROJECT_ROOT,
  process.env.IMAGE_CACHE_ROOT ?? path.join(".cache", "images"),
);
const INDEX_FILE = path.join(CACHE_ROOT, "source-index.json");
const SITE_ROOT = path.resolve(PROJECT_ROOT, process.env.SITE_ROOT ?? "_site");

// Encoder settings for every photographic derivative. WebP is used for all
// photographs: every browser the club's audience uses supports it, and keeping
// a JPEG fallback would double the deployed file count for no practical gain.
export const ENCODER = {
  format: "webp",
  quality: 82,
  effort: 4,
  extension: "webp",
};

// Derivative widths per rendered role. Keep these in step with the templates:
// only widths that templates actually request are ever generated.
export const ROLE_WIDTHS = {
  grid: [400, 800],
  content: [800, 1600],
  lightbox: [1600],
  logo: [112, 224],
};

/**
 * The raster formats the pipeline treats as source photographs. Everything
 * else under `Images/` (markdown notes, scripts, SVG logos) is passed through
 * untouched and is *not* a protected original — see tools/verify-source-images.mjs.
 */
export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);

// A handful of archive scans are truncated JPEGs that browsers still render.
// Reading them leniently keeps the archive complete instead of failing the build.
const SHARP_READ_OPTIONS = { failOn: "none" };

/**
 * Sample mode (IMAGE_PIPELINE_SAMPLE=1) generates derivatives for one gallery
 * image, one PhotoAlbum image, one archive image, one news image, one logo and
 * the homepage hero only, so the pipeline can be validated before the whole
 * library is processed.
 */
const SAMPLE_SOURCES = new Set([
  "Images/2025/Top15Final/20250810_134840.jpg",
  "Images/2025/Top15Final/20250810_134840-thumb.jpg",
  "Images/2025/PresentationDance2025/20251025_200718.jpg",
  "Images/SD Archive/20250506_120512.jpg",
  "Images/Archive/Photo 2.jpg",
  "Images/Archive/Photo 2-thumb.jpg",
  "Images/2026/Chucks 2026/Winners.jpg",
  "Images/forwardsector.png",
  "Images/club-logo.png",
  "Images/Archive/Photo 25.jpg",
]);

export const SAMPLE_MODE = process.env.IMAGE_PIPELINE_SAMPLE === "1";

const isSampled = (relative) => !SAMPLE_MODE || SAMPLE_SOURCES.has(relative);

/**
 * Cloud-synced working copies (OneDrive) can briefly lock generated files, so
 * transient filesystem errors are retried with a short backoff.
 */
async function withRetry(operation, { attempts = 6, delayMs = 250, label = "file operation" } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!["EPERM", "EBUSY", "EACCES", "ENOENT", "UNKNOWN"].includes(error.code)) {
        throw error;
      }
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError.message}`);
}

let sourceIndex = null;
let indexDirty = false;

const derivativeJobs = new Map();
const graphicJobs = new Map();
const copyJobs = new Set();

function normaliseSource(source) {
  // Some legacy markup URL-encodes spaces; the archive stores the real filename.
  let decoded = source;
  try {
    decoded = decodeURIComponent(source);
  } catch {
    // Leave malformed escapes untouched.
  }

  const relative = decoded.replace(/^(?:\.\.\/|\.\/)+/, "");
  const prefix = decoded.slice(0, decoded.length - relative.length);

  if (!relative.startsWith("Images/")) {
    throw new Error(`Image references must live under Images/: ${source}`);
  }

  return { prefix, relative };
}

function splitFile(relative) {
  const directory = path.posix.dirname(relative);
  const file = path.posix.basename(relative);
  const extension = path.posix.extname(file);
  const stem = file.slice(0, file.length - extension.length);
  return { directory, file, extension, stem };
}

/**
 * Percent-encodes each path segment. Spaces (and other characters such as
 * commas) would otherwise break `srcset` parsing: a space terminates a
 * candidate URL, which makes browsers fall back to the largest `src`.
 */
function encodeUrlPath(relativePath) {
  return relativePath.split("/").map(encodeURIComponent).join("/");
}

async function readSourceIndex() {
  if (sourceIndex) {
    return sourceIndex;
  }

  try {
    sourceIndex = new Map(
      Object.entries(JSON.parse(await readFile(INDEX_FILE, "utf8")).entries ?? {}),
    );
  } catch {
    sourceIndex = new Map();
  }

  return sourceIndex;
}

async function walkOriginals(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkOriginals(fullPath, relative)));
    } else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(relative);
    }
  }

  return files;
}

/**
 * Reads dimensions for every source image once per build. Files whose size and
 * modification time are unchanged reuse the cached metadata, so only new or
 * edited photographs cost a Sharp decode.
 */
export async function loadSourceIndex() {
  const index = await readSourceIndex();
  const files = await walkOriginals(ORIGINALS_ROOT);
  const seen = new Set();

  for (const relative of files) {
    const repoRelative = `Images/${relative}`;
    const fullPath = path.join(ORIGINALS_ROOT, relative);
    const fileStat = await stat(fullPath);
    seen.add(repoRelative);

    const existing = index.get(repoRelative);
    if (existing && existing.bytes === fileStat.size && existing.mtimeMs === fileStat.mtimeMs) {
      continue;
    }

    const record = {
      bytes: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      width: null,
      height: null,
    };

    if (path.extname(relative).toLowerCase() !== ".svg") {
      const metadata = await sharp(fullPath, SHARP_READ_OPTIONS).metadata();
      const rotated = (metadata.orientation ?? 1) >= 5;
      record.width = rotated ? metadata.height : metadata.width;
      record.height = rotated ? metadata.width : metadata.height;
    }

    index.set(repoRelative, record);
    indexDirty = true;
  }

  for (const key of [...index.keys()]) {
    if (!seen.has(key)) {
      index.delete(key);
      indexDirty = true;
    }
  }

  if (indexDirty) {
    await mkdir(CACHE_ROOT, { recursive: true });
    await writeFile(
      INDEX_FILE,
      `${JSON.stringify({ entries: Object.fromEntries(index) }, null, 2)}\n`,
      "utf8",
    );
  }

  return index;
}

export function sourceDimensions(source) {
  if (!sourceIndex) {
    throw new Error("loadSourceIndex() must run before rendering: no image index available");
  }
  return sourceIndex.get(normaliseSource(source).relative) ?? null;
}

/** Width actually generated: never upscales past the original photograph. */
export function effectiveWidth(source, requestedWidth) {
  const dimensions = sourceDimensions(source);
  const sourceWidth = dimensions?.width ?? requestedWidth;
  return Math.min(requestedWidth, sourceWidth);
}

export function derivativeUrl(source, requestedWidth) {
  const { prefix, relative } = normaliseSource(source);
  const { directory, stem } = splitFile(relative);
  const file = encodeUrlPath(`${directory}/${stem}-w${requestedWidth}.${ENCODER.extension}`);
  return `${prefix}${file}`;
}

/** Registers a derivative for generation and returns its public URL. */
export function imageUrl(source, requestedWidth) {
  const { relative } = normaliseSource(source);
  const width = effectiveWidth(source, requestedWidth);
  derivativeJobs.set(`${relative}@${requestedWidth}`, {
    relative,
    width,
    outputWidth: requestedWidth,
  });
  return derivativeUrl(source, requestedWidth);
}

/** Registers every candidate width and returns a srcset string. */
export function imageSrcset(source, requestedWidths) {
  // One candidate per real pixel width: a narrower original must not be
  // re-encoded several times for identical output.
  const byEffectiveWidth = new Map();
  for (const requestedWidth of requestedWidths) {
    const effective = effectiveWidth(source, requestedWidth);
    if (!byEffectiveWidth.has(effective)) {
      byEffectiveWidth.set(effective, requestedWidth);
    }
  }

  return [...byEffectiveWidth.entries()]
    .sort(([left], [right]) => left - right)
    .map(([effective, requestedWidth]) => `${imageUrl(source, requestedWidth)} ${effective}w`)
    .join(", ");
}

/** Publishes an original file unchanged (logos, vector marks, favicons). */
export function imageOriginal(source) {
  const { relative } = normaliseSource(source);
  copyJobs.add(relative);
  const { prefix } = normaliseSource(source);
  return `${prefix}${encodeUrlPath(relative)}`;
}

/**
 * Resizes a graphic (logo, badge, diagram) while keeping its original format
 * so sharp edges and transparency are not degraded by photographic encoding.
 * Vector files are published untouched.
 */
export function imageGraphic(source, requestedWidth) {
  const { prefix, relative } = normaliseSource(source);
  if (relative.toLowerCase().endsWith(".svg")) {
    return imageOriginal(source);
  }

  const width = effectiveWidth(source, requestedWidth);
  const { directory, stem, extension } = splitFile(relative);
  graphicJobs.set(`${relative}@${requestedWidth}`, {
    relative,
    width,
    outputWidth: requestedWidth,
    extension,
  });
  return `${prefix}${encodeUrlPath(`${directory}/${stem}-w${requestedWidth}${extension}`)}`;
}

/** Intrinsic size of the derivative, for width/height attributes. */
export function imageSize(source, requestedWidth) {
  const dimensions = sourceDimensions(source);
  const width = effectiveWidth(source, requestedWidth);
  if (!dimensions?.width || !dimensions?.height) {
    return { width, height: null };
  }
  const height = Math.round((dimensions.height / dimensions.width) * width);
  return { width, height };
}

export function imageAttributes(source, requestedWidth, { sizes, widths = ROLE_WIDTHS.grid } = {}) {
  const size = imageSize(source, requestedWidth);
  const srcset = imageSrcset(source, widths);
  return {
    src: derivativeUrl(source, requestedWidth),
    srcset,
    sizes: sizes ?? null,
    width: size.width,
    height: size.height,
  };
}

async function deployFile(fromPath, toPath) {
  await mkdir(path.dirname(toPath), { recursive: true });
  await withRetry(() => rm(toPath, { force: true }), { label: `remove ${toPath}` });
  // Real copies, not hard links: cloud-synced working copies (OneDrive) treat
  // hard links as reparse points and can drop them from the generated artifact.
  await withRetry(() => copyFile(fromPath, toPath), { label: `copy ${toPath}` });
}

async function ensureCachedOutput({ relative, width, cacheTag, extension, transform, outputName }) {
  const originalPath = path.join(PROJECT_ROOT, relative);
  const originalStat = await stat(originalPath);
  const key = createHash("sha256")
    .update(`${relative}|${originalStat.size}|${originalStat.mtimeMs}|${cacheTag}`)
    .digest("hex")
    .slice(0, 32);
  const cachePath = path.join(CACHE_ROOT, `${key}.${extension}`);
  const { directory, stem } = splitFile(relative);
  const deployedRelative = path.posix.join(
    directory,
    outputName ?? `${stem}-w${width}.${extension}`,
  );
  const deployedPath = path.join(SITE_ROOT, deployedRelative);

  let cacheHit = true;
  try {
    await stat(cachePath);
  } catch {
    cacheHit = false;
    await mkdir(path.dirname(cachePath), { recursive: true });
    await transform(originalPath, cachePath);
  }

  await deployFile(cachePath, deployedPath);
  const deployedStat = await stat(deployedPath);

  return {
    cacheHit,
    deployedRelative,
    bytes: deployedStat.size,
    sourceBytes: originalStat.size,
  };
}

function derivativeTransform(width) {
  return (originalPath, cachePath) =>
    sharp(originalPath, SHARP_READ_OPTIONS)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: ENCODER.quality, effort: ENCODER.effort })
      .toFile(cachePath);
}

function graphicTransform(extension, width) {
  return (originalPath, cachePath) => {
    const pipeline = sharp(originalPath, SHARP_READ_OPTIONS)
      .rotate()
      .resize({ width, withoutEnlargement: true });

    if (extension === ".png") {
      pipeline.png({ compressionLevel: 9, palette: false });
    } else if (extension === ".webp") {
      pipeline.webp({ quality: ENCODER.quality, effort: ENCODER.effort });
    } else if (extension === ".jpg" || extension === ".jpeg") {
      pipeline.jpeg({ quality: ENCODER.quality, mozjpeg: true });
    }

    return pipeline.toFile(cachePath);
  };
}

async function ensureDerivative({ relative, width, outputWidth }) {
  const { stem } = splitFile(relative);
  return ensureCachedOutput({
    relative,
    width,
    cacheTag: `photo|w${width}|q${ENCODER.quality}`,
    extension: ENCODER.extension,
    transform: derivativeTransform(width),
    outputName: `${stem}-w${outputWidth}.${ENCODER.extension}`,
  });
}

async function ensureGraphic({ relative, width, outputWidth }) {
  const { extension } = splitFile(relative);
  return ensureCachedOutput({
    relative,
    width,
    cacheTag: `graphic|w${width}|${extension}`,
    extension: extension.replace(".", ""),
    transform: graphicTransform(extension.toLowerCase(), width),
    outputName: `${splitFile(relative).stem}-w${outputWidth}${extension}`,
  });
}

async function ensureOriginalCopy(relative) {
  const originalPath = path.join(PROJECT_ROOT, relative);
  const deployedPath = path.join(SITE_ROOT, relative);
  await deployFile(originalPath, deployedPath);
  return {
    cacheHit: true,
    deployedRelative: relative,
    bytes: (await stat(deployedPath)).size,
    sourceBytes: (await stat(originalPath)).size,
  };
}

function decodeReference(reference) {
  let value = reference;
  try {
    value = decodeURIComponent(value);
  } catch {
    // Leave malformed escapes untouched.
  }
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function collectReferencedImages(directory, baseRelative = "", collected = new Map()) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectReferencedImages(
        fullPath,
        baseRelative ? `${baseRelative}/${entry.name}` : entry.name,
        collected,
      );
      continue;
    }
    if (!/\.(?:html|css|js)$/i.test(entry.name)) {
      continue;
    }

    const source = await readFile(fullPath, "utf8");
    const candidates = [];

    for (const match of source.matchAll(/\s(?:src|href)="([^"]+)"/gi)) {
      candidates.push(match[1]);
    }
    for (const match of source.matchAll(/\ssrcset="([^"]+)"/gi)) {
      for (const candidate of match[1].split(",")) {
        // A candidate is "<url> <width>w"; the URL itself may contain spaces.
        const url = candidate.trim().replace(/\s+\d+(?:\.\d+)?[wx]$/, "");
        if (url) {
          candidates.push(url);
        }
      }
    }
    for (const match of source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
      candidates.push(match[1]);
    }

    for (const candidate of candidates) {
      const reference = decodeReference(candidate);
      if (!/Images\//i.test(reference) || reference.includes("${")) {
        continue;
      }
      collected.set(reference, baseRelative);
    }
  }

  return collected;
}

async function expandGeneratedReferences(directory, expanded = new Set()) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await expandGeneratedReferences(fullPath, expanded);
      continue;
    }
    if (!/\.(?:html|js)$/i.test(entry.name)) {
      continue;
    }

    const source = await readFile(fullPath, "utf8");
    const loops = [
      ...source.matchAll(
        /for\s*\(\s*(?:let|var)\s+(\w+)\s*=\s*(\d+)\s*;\s*\1\s*<=\s*(\d+)\s*;\s*\1\+\+\s*\)/g,
      ),
    ];

    for (const loop of loops) {
      const [, variable, start, end] = loop;
      const bodyStart = loop.index;
      const bodyEnd = source.indexOf("\n", source.indexOf("}", bodyStart));
      const body = source.slice(bodyStart, bodyEnd === -1 ? undefined : bodyEnd);
      const code = `["'\`]([^"'\`]*\\$\\{${variable}\\}[^"'\`]*)["'\`]`;

      for (const reference of body.matchAll(new RegExp(code, "g"))) {
        if (!/Images\//i.test(reference[1])) {
          continue;
        }
        for (let value = Number(start); value <= Number(end); value += 1) {
          expanded.add(
            decodeReference(reference[1].replace(new RegExp(`\\$\\{${variable}\\}`, "g"), String(value))),
          );
        }
      }
    }
  }

  return expanded;
}

/**
 * Generates every derivative requested during rendering, publishes the images
 * into `_site`, then verifies that every image reference in the built site
 * resolves to a deployed file.
 */
export async function generateSiteImages() {
  await loadSourceIndex();
  await mkdir(SITE_ROOT, { recursive: true });

  let derived = 0;
  let cacheHits = 0;
  let derivedBytes = 0;
  let sourceBytes = 0;

  for (const job of [...derivativeJobs.values()].sort((left, right) =>
    `${left.relative}${left.width}`.localeCompare(`${right.relative}${right.width}`),
  )) {
    if (!isSampled(job.relative)) {
      continue;
    }
    const result = await ensureDerivative(job).catch((error) => {
      throw new Error(`Failed to build ${job.relative} at ${job.width}px: ${error.message}`);
    });
    derived += 1;
    derivedBytes += result.bytes;
    sourceBytes += result.sourceBytes;
    if (result.cacheHit) {
      cacheHits += 1;
    }
  }

  let graphics = 0;
  for (const job of [...graphicJobs.values()].sort((left, right) =>
    `${left.relative}${left.width}`.localeCompare(`${right.relative}${right.width}`),
  )) {
    if (!isSampled(job.relative)) {
      continue;
    }
    const result = await ensureGraphic(job);
    graphics += 1;
    derivedBytes += result.bytes;
    sourceBytes += result.sourceBytes;
    if (result.cacheHit) {
      cacheHits += 1;
    }
  }

  let copied = 0;
  for (const relative of [...copyJobs].sort()) {
    if (!isSampled(relative)) {
      continue;
    }
    await ensureOriginalCopy(relative);
    copied += 1;
  }

  if (SAMPLE_MODE) {
    return {
      sampleMode: true,
      derivativeCount: derived,
      graphicCount: graphics,
      derivativeCacheHits: cacheHits,
      derivativeBytes: derivedBytes,
      originalCount: copied,
      sourceBytesForDerivatives: sourceBytes,
      referenceCount: 0,
    };
  }

  const references = await collectReferencedImages(SITE_ROOT);
  for (const reference of await expandGeneratedReferences(SITE_ROOT)) {
    // Generated markup is emitted by gallery.html, which sits at the site root.
    references.set(reference, "");
  }

  const missing = [];
  for (const [reference, pageDirectory] of references) {
    // References are relative to the page that contains them.
    const deployedPath = path.resolve(SITE_ROOT, pageDirectory, decodeReference(reference));
    try {
      const fileStat = await withRetry(() => stat(deployedPath), {
        label: `verify ${reference}`,
        attempts: 4,
      });
      if (!fileStat.isFile()) {
        missing.push(reference);
      }
    } catch {
      missing.push(reference);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Image pipeline produced ${missing.length} unresolved reference(s):\n${missing
        .slice(0, 20)
        .join("\n")}`,
    );
  }

  return {
    derivativeCount: derived,
    graphicCount: graphics,
    derivativeCacheHits: cacheHits,
    derivativeBytes: derivedBytes,
    originalCount: copied,
    sourceBytesForDerivatives: sourceBytes,
    referenceCount: references.size,
  };
}

/** Test helper: describes every derivative requested during a build. */
export function requestedDerivatives() {
  return [...derivativeJobs.values()].map((job) => ({ ...job }));
}
