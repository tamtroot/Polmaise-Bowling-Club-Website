import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const imagesRoot = path.join(root, "Images");
const reportRoot = path.join(root, "reports", "stage6");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif"]);

// Rendered width each role is expected to need, used to flag oversized sources.
const ROLE_TARGET_WIDTH = {
  "gallery-grid": 400,
  "archive-grid": 400,
  "album-grid": 500,
  card: 400,
  thumbnail: 400,
  lightbox: 1600,
  article: 900,
  hero: 1600,
  logo: 300,
  decorative: 800,
};

async function walkImages(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkImages(fullPath, relativePath)));
    } else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(relativePath);
    }
  }

  return files;
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

// Image origins are recorded as paths relative to the repository root.
function toRepoPath(reference, referenceDirectory = "") {
  const cleaned = decodeReference(reference).split("?")[0].split("#")[0];
  const resolved = path.resolve(root, referenceDirectory, cleaned);
  return path.relative(root, resolved).split(path.sep).join("/");
}

// Template output can contain URL encoding and HTML entities that the browser
// resolves before requesting the image.
const NAMED_ENTITIES = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", "#39": "'" };

function decodeReference(reference) {
  let value = reference;
  try {
    value = decodeURIComponent(value);
  } catch {
    // Leave malformed percent escapes as-is.
  }
  return value.replace(/&(#?\w+);/g, (match, name) =>
    Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : match,
  );
}

async function collectSourceImages() {
  const relativePaths = (await walkImages(imagesRoot)).sort();
  const images = new Map();

  for (const relativePath of relativePaths) {
    const fullPath = path.join(imagesRoot, relativePath);
    const fileStat = await stat(fullPath);
    const extension = path.extname(relativePath).toLowerCase();
    const record = {
      path: `Images/${relativePath}`,
      bytes: fileStat.size,
      format: extension.replace(".", ""),
      width: null,
      height: null,
      hash: await hashFile(fullPath),
    };

    if (extension !== ".svg") {
      try {
        const metadata = await sharp(fullPath).metadata();
        record.width = metadata.width ?? null;
        record.height = metadata.height ?? null;
        record.format = metadata.format ?? record.format;
      } catch (error) {
        record.metadataError = error.message;
      }
    }

    images.set(record.path, record);
  }

  return images;
}

function addReference(references, { page, role, reference, referenceDirectory = "", note = "" }) {
  if (!reference || /^(?:https?:)?\/\//.test(reference) || reference.startsWith("data:")) {
    return;
  }
  // Skip Nunjucks expressions and JavaScript template literals: those are
  // expanded per record and are already covered by the data-file references.
  if (reference.includes("{{") || reference.includes("${")) {
    return;
  }
  references.push({
    page,
    role,
    note,
    source: toRepoPath(reference, referenceDirectory),
  });
}

async function collectDataReferences(references) {
  const gallery = JSON.parse(await readFile(path.join(root, "_data", "gallery.json"), "utf8"));
  for (const card of gallery.cards) {
    if (card.thumbnail?.src) {
      addReference(references, { page: "gallery.html", role: "card", reference: card.thumbnail.src });
    }
  }
  for (const album of gallery.albums) {
    for (const section of album.sections) {
      for (const image of section.images) {
        addReference(references, {
          page: `gallery.html#${album.id}`,
          role: "gallery-grid",
          reference: image.src,
        });
        addReference(references, {
          page: `gallery.html#${album.id}`,
          role: "lightbox",
          reference: image.href,
        });
      }
    }
  }

  const archive = JSON.parse(await readFile(path.join(root, "_data", "archive.json"), "utf8"));
  for (const item of archive.items) {
    addReference(references, { page: "archive.html", role: "archive-grid", reference: item.href });
    addReference(references, { page: "archive.html", role: "lightbox", reference: item.href });
  }

  const photoAlbums = JSON.parse(await readFile(path.join(root, "_data", "photoAlbums.json"), "utf8"));
  for (const [slug, album] of Object.entries(photoAlbums)) {
    for (const filename of album.images) {
      addReference(references, {
        page: `PhotoAlbums/${slug}.html`,
        role: "album-grid",
        reference: `${album.directory}${filename}`,
        referenceDirectory: "PhotoAlbums",
      });
      addReference(references, {
        page: `PhotoAlbums/${slug}.html`,
        role: "lightbox",
        reference: `${album.directory}${filename}`,
        referenceDirectory: "PhotoAlbums",
      });
    }
  }

  const sponsors = JSON.parse(await readFile(path.join(root, "_data", "sponsors.json"), "utf8"));
  for (const sponsor of sponsors.main) {
    if (sponsor.banner?.src) {
      addReference(references, { page: "sponsors.html", role: "article", reference: sponsor.banner.src });
    }
    for (const contact of sponsor.contacts) {
      if (contact.href?.includes("Images/")) {
        addReference(references, {
          page: "sponsors.html",
          role: "decorative",
          reference: contact.href,
        });
      }
    }
  }
  for (const sponsor of sponsors.club) {
    if (sponsor.logo?.src) {
      addReference(references, { page: "sponsors.html", role: "logo", reference: sponsor.logo.src });
    }
  }
}

async function collectHtmlReferences(references) {
  const htmlFiles = [
    ...(await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
      .map((entry) => entry.name),
    ...(await readdir(path.join(root, "PhotoAlbums")))
      .filter((name) => name.endsWith(".html"))
      .map((name) => `PhotoAlbums/${name}`),
    ...(await readdir(path.join(root, "News articles")))
      .filter((name) => name.endsWith(".html"))
      .map((name) => `News articles/${name}`),
  ];

  for (const file of htmlFiles) {
    const source = await readFile(path.join(root, file), "utf8");
    const directory = path.dirname(file);

    for (const match of source.matchAll(/<img\b[^>]*>/gi)) {
      const tag = match[0];
      const src = tag.match(/\bsrc="([^"]+)"/i)?.[1];
      if (!src) continue;
      const isIntroOrFeatured = /classes|class="[^"]*(?:album-intro|article|featured|hero|banner)/i.test(tag);
      addReference(references, {
        page: file,
        role: isIntroOrFeatured ? "article" : "thumbnail",
        reference: src,
        referenceDirectory: directory,
        note: tag.trim().slice(0, 120),
      });
    }

    // Photographs rendered through the photoImage shortcode.
    for (const match of source.matchAll(/\{%\s*photoImage\s+("(?:[^"\\]|\\.)*")\s*,/g)) {
      const reference = match[1].slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      if (!reference.includes("Images/")) {
        continue;
      }
      addReference(references, {
        page: file,
        role: "article",
        reference,
        referenceDirectory: directory,
        note: "photoImage shortcode",
      });
    }

    for (const match of source.matchAll(/background(?:-image)?\s*:\s*url\(([^)]+)\)/gi)) {
      addReference(references, {
        page: file,
        role: "decorative",
        reference: match[1].replace(/["']/g, "").trim(),
        referenceDirectory: directory,
      });
    }
  }
}

async function collectStylesheetReferences(references) {
  const css = await readFile(path.join(root, "styles.css"), "utf8");
  for (const match of css.matchAll(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi)) {
    addReference(references, {
      page: "styles.css",
      role: "decorative",
      reference: match[2].trim(),
    });
  }
}

// The gallery page builds the archive album in JS with a numeric path pattern.
function collectGeneratedReferences(references) {
  addReference(references, {
    page: "gallery.html#album7",
    role: "archive-grid",
    reference: "./Images/Archive/1914 - 1-thumb.jpg",
    note: "generated inline script",
  });
  addReference(references, {
    page: "gallery.html#album7",
    role: "lightbox",
    reference: "./Images/Archive/1914 - 1.jpg",
    note: "generated inline script",
  });
  addReference(references, {
    page: "gallery.html#album7",
    role: "archive-grid",
    reference: "./Images/Archive/1988-thumb.jpg",
    note: "generated inline script",
  });
  addReference(references, {
    page: "gallery.html#album7",
    role: "lightbox",
    reference: "./Images/Archive/1988.jpg",
    note: "generated inline script",
  });
  for (let index = 2; index <= 191; index += 1) {
    addReference(references, {
      page: "gallery.html#album7",
      role: "archive-grid",
      reference: `./Images/Archive/Photo ${index}-thumb.jpg`,
      note: "generated inline script loop",
    });
    addReference(references, {
      page: "gallery.html#album7",
      role: "lightbox",
      reference: `./Images/Archive/Photo ${index}.jpg`,
      note: "generated inline script loop",
    });
  }
}

function formatMiB(bytes) {
  return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
}

const images = await collectSourceImages();
const references = [];

await collectDataReferences(references);
await collectHtmlReferences(references);
await collectStylesheetReferences(references);
collectGeneratedReferences(references);

const missingTargets = [];
const bySource = new Map();
for (const reference of references) {
  const image = images.get(reference.source);
  if (!image) {
    missingTargets.push(reference);
    continue;
  }
  const record = bySource.get(reference.source) ?? {
    path: reference.source,
    bytes: image.bytes,
    format: image.format,
    width: image.width,
    height: image.height,
    roles: new Set(),
    pages: new Set(),
    targetWidth: 0,
  };
  record.roles.add(reference.role);
  record.pages.add(reference.page);
  record.targetWidth = Math.max(record.targetWidth, ROLE_TARGET_WIDTH[reference.role] ?? 800);
  bySource.set(reference.source, record);
}

const unreferenced = [...images.values()].filter((image) => !bySource.has(image.path));

const totalBytes = [...images.values()].reduce((total, image) => total + image.bytes, 0);
const byFormat = new Map();
const byDirectory = new Map();
const byRole = new Map();
for (const reference of references) {
  const role = byRole.get(reference.role) ?? { references: 0, sources: new Set() };
  role.references += 1;
  role.sources.add(reference.source);
  byRole.set(reference.role, role);
}
for (const image of images.values()) {
  const format = byFormat.get(image.format) ?? { files: 0, bytes: 0 };
  format.files += 1;
  format.bytes += image.bytes;
  byFormat.set(image.format, format);

  const topLevel = image.path.split("/").slice(1, 2)[0] ?? "(root)";
  const directory = byDirectory.get(topLevel) ?? { files: 0, bytes: 0 };
  directory.files += 1;
  directory.bytes += image.bytes;
  byDirectory.set(topLevel, directory);
}

const duplicateGroups = new Map();
for (const image of images.values()) {
  const group = duplicateGroups.get(image.hash) ?? [];
  group.push(image.path);
  duplicateGroups.set(image.hash, group);
}
const duplicates = [...duplicateGroups.values()]
  .filter((group) => group.length > 1)
  .map((group) => ({
    paths: group.sort(),
    bytes: images.get(group[0]).bytes,
    wastedBytes: images.get(group[0]).bytes * (group.length - 1),
  }))
  .sort((left, right) => right.wastedBytes - left.wastedBytes);

const referencedRecords = [...bySource.values()].map((record) => {
  const ratio = record.width ? record.width / record.targetWidth : null;
  return {
    ...record,
    roles: [...record.roles].sort(),
    pages: [...record.pages].sort(),
    oversizeRatio: ratio ? Number(ratio.toFixed(2)) : null,
  };
});

const oversized = referencedRecords
  .filter((record) => record.oversizeRatio !== null && record.oversizeRatio >= 2.5)
  .sort((left, right) => right.bytes - left.bytes);

const largest = [...images.values()].sort((left, right) => right.bytes - left.bytes).slice(0, 50);

const audit = {
  generatedAt: new Date().toISOString(),
  summary: {
    sourceImageCount: images.size,
    sourceTotalBytes: totalBytes,
    referencedImageCount: bySource.size,
    referenceCount: references.length,
    unreferencedImageCount: unreferenced.length,
    unreferencedBytes: unreferenced.reduce((total, image) => total + image.bytes, 0),
    duplicateGroupCount: duplicates.length,
    duplicateWastedBytes: duplicates.reduce((total, group) => total + group.wastedBytes, 0),
    oversizedForRoleCount: oversized.length,
    oversizedForRoleBytes: oversized.reduce((total, record) => total + record.bytes, 0),
    missingTargetCount: missingTargets.length,
  },
  byFormat: Object.fromEntries([...byFormat.entries()].sort((a, b) => b[1].bytes - a[1].bytes)),
  byDirectory: Object.fromEntries(
    [...byDirectory.entries()].sort((a, b) => b[1].bytes - a[1].bytes),
  ),
  byRole: Object.fromEntries(
    [...byRole.entries()]
      .map(([role, value]) => [role, { references: value.references, sources: value.sources.size }])
      .sort((a, b) => b[1].references - a[1].references),
  ),
  roleTargets: ROLE_TARGET_WIDTH,
  largest,
  oversized,
  duplicates,
  missingTargets,
  unreferenced: unreferenced.sort((left, right) => right.bytes - left.bytes),
  referencedImages: referencedRecords.sort((left, right) => right.bytes - left.bytes),
};

await mkdir(reportRoot, { recursive: true });
await writeFile(
  path.join(reportRoot, "image-audit.json"),
  `${JSON.stringify(audit, null, 2)}\n`,
  "utf8",
);

const lines = [
  "# Stage 6 image audit",
  "",
  `- Source images: ${images.size} files, ${formatMiB(totalBytes)}`,
  `- Referenced by the site: ${bySource.size} files (${references.length} references)`,
  `- Not referenced anywhere: ${unreferenced.length} files, ${formatMiB(audit.summary.unreferencedBytes)}`,
  `- Duplicate groups: ${duplicates.length} (${formatMiB(audit.summary.duplicateWastedBytes)} duplicated)`,
  `- Oversized for their rendered role (>=2.5x): ${oversized.length} files, ${formatMiB(audit.summary.oversizedForRoleBytes)}`,
  `- References with no matching source file: ${missingTargets.length}`,
  "",
  "## Size by format",
  "",
  "| Format | Files | Size |",
  "| --- | --- | --- |",
  ...Object.entries(audit.byFormat).map(
    ([format, value]) => `| ${format} | ${value.files} | ${formatMiB(value.bytes)} |`,
  ),
  "",
  "## Size by source directory",
  "",
  "## References by rendered role",
  "",
  "| Role | References | Distinct sources |",
  "| --- | --- | --- |",
  ...Object.entries(audit.byRole).map(
    ([role, value]) => `| ${role} | ${value.references} | ${value.sources} |`,
  ),
  "",
  "| Directory | Files | Size |",
  "| --- | --- | --- |",
  ...Object.entries(audit.byDirectory).map(
    ([directory, value]) => `| ${directory} | ${value.files} | ${formatMiB(value.bytes)} |`,
  ),
  "",
  "## 15 largest source images",
  "",
  "| Path | Size | Dimensions |",
  "| --- | --- | --- |",
  ...largest
    .slice(0, 15)
    .map((image) => `| ${image.path} | ${formatMiB(image.bytes)} | ${image.width}x${image.height} |`),
  "",
  "## 15 most oversized-for-role sources",
  "",
  "| Path | Size | Dimensions | Roles | Target | Ratio |",
  "| --- | --- | --- | --- | --- | --- |",
  ...oversized
    .slice(0, 15)
    .map(
      (record) =>
        `| ${record.path} | ${formatMiB(record.bytes)} | ${record.width}x${record.height} | ${record.roles.join(", ")} | ${record.targetWidth}px | ${record.oversizeRatio}x |`,
    ),
  "",
  "## Duplicate groups",
  "",
  ...duplicates
    .slice(0, 20)
    .map((group) => `- ${formatMiB(group.bytes)} each: ${group.paths.join(" = ")}`),
  "",
  "## References without a matching source file",
  "",
  ...(missingTargets.length > 0
    ? missingTargets.map(
        (reference) => `- ${reference.page} (${reference.role}) -> ${reference.source}`,
      )
    : ["- none"]),
  "",
];

await writeFile(path.join(reportRoot, "image-audit.md"), `${lines.join("\n")}\n`, "utf8");

console.log(lines.slice(0, 8).join("\n"));
console.log(`\nWrote reports/stage6/image-audit.json and image-audit.md`);
