import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { writeMeasurement } from "./helpers/baseline.mjs";
import { SITE_ROOT, SOURCE_ROOT } from "./helpers/site-root.mjs";
import { SITE_PAGES } from "./helpers/site-pages.mjs";

const stageTwoASnapshotRoot = path.join(SOURCE_ROOT, "reports", "stage-2a");
const expectedActiveNavigation = {
  home: "index.html",
  about: "about.html",
  membership: "membership.html",
  fixtures: "fixtures.html",
  news: "news.html",
  gallery: "gallery.html",
  contact: "contact.html",
  sponsors: "sponsors.html",
  honours: "honours.html",
  archive: "",
  history: "",
  signup: "",
  "live-scoring": "",
  "news-presentation-dance-2025": "",
  "album-presentation-dance-2025": "../gallery.html",
  "album-charlie-mcneil-memorial-2025": "../gallery.html",
  "album-top-15-final-2025": "../gallery.html",
  "album-twa-peters-memorial-2025": "../gallery.html",
};

async function collectRelativeFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(prefix, entry.name);
    const fullPath = path.join(directory, entry.name);
    // stat() rather than the dirent type: OneDrive marks hard-linked files as
    // reparse points, which readdir reports as neither file nor directory.
    const entryStat = await stat(fullPath).catch(() => null);
    if (!entryStat) {
      continue;
    }
    if (entryStat.isDirectory()) {
      files.push(...(await collectRelativeFiles(fullPath, relativePath)));
    } else if (entryStat.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

const imageManifestPath = path.join(SOURCE_ROOT, "reports", "stage6", "source-image-manifest.json");

/**
 * Stage 6 no longer publishes the source archive: the site serves build-time
 * derivatives. Two things still need proving on every run.
 *   1. Every original photograph from the archive is still present, unmodified.
 *   2. Everything deployed under _site/Images is derived from a real original.
 */
async function verifyImageDeployment() {
  const manifest = JSON.parse(await readFile(imageManifestPath, "utf8"));
  const missingOriginals = [];
  const changedOriginals = [];
  const originalStems = new Set();

  for (const [relativePath, entry] of Object.entries(manifest.entries)) {
    const originalPath = path.join(SOURCE_ROOT, relativePath);
    const originalStat = await stat(originalPath).catch(() => null);
    if (!originalStat) {
      missingOriginals.push(relativePath);
      continue;
    }
    if (originalStat.size !== entry.bytes) {
      changedOriginals.push(`${relativePath}: ${entry.bytes} -> ${originalStat.size}`);
    }
    originalStems.add(relativePath.replace(/\.[^.]+$/, ""));
  }

  expect(missingOriginals).toEqual([]);
  expect(changedOriginals).toEqual([]);

  const deployed = await collectRelativeFiles(path.join(SITE_ROOT, "Images"));
  const unexpected = [];
  let derivativeCount = 0;
  let copiedOriginalCount = 0;
  let deployedBytes = 0;

  for (const relativePath of deployed) {
    const comparablePath = path.posix.join("Images", relativePath.split(path.sep).join("/"));
    deployedBytes += (await stat(path.join(SITE_ROOT, "Images", relativePath))).size;

    if (manifest.entries[comparablePath]) {
      copiedOriginalCount += 1;
      continue;
    }

    const derivative = comparablePath.match(/^(.*)-w\d+(\.[a-z0-9]+)$/i);
    if (derivative && originalStems.has(derivative[1])) {
      derivativeCount += 1;
      continue;
    }

    unexpected.push(comparablePath);
  }

  expect(unexpected).toEqual([]);
  expect(derivativeCount).toBeGreaterThan(2000);

  return {
    originalCount: Object.keys(manifest.entries).length,
    derivativeCount,
    copiedOriginalCount,
    deployedBytes,
  };
}

function normaliseDocument(document) {
  const ignoredTags = new Set(["script", "style"]);
  const ignoredEventAttributes = new Set([
    "data-action",
    "data-album-link",
    "data-album-open",
    "data-back-to-albums",
    "data-close-album",
    "data-close-privacy",
    "data-cookie-action",
    "data-href",
    "data-history-archive-toggle",
    "data-history-article",
    "data-history-close",
    "data-image-viewer",
    "data-news-archive-toggle",
    "data-news-article",
    "data-news-close",
    "data-purchase-message",
  ]);
  const ignoredCssClasses = new Set([
    "gallery-image-top",
    "gallery-image-top-position",
    "news-image-spaced",
    "historical-quote",
    "historical-image-wrapper",
    "historical-feature-image",
    "historical-clipping-image",
    "historical-clipping-frame",
    "historical-inline-image",
    "historical-list",
    "historical-section",
  ]);
  // Stage 6 serves build-time image derivatives with responsive attributes, so
  // the image-specific presentation attributes are intentionally different from
  // the Stage 2A snapshot. Element structure, classes and all other attributes
  // are still compared exactly.
  const ignoredImageAttributes = new Set([
    "src",
    "srcset",
    "sizes",
    "width",
    "height",
    "loading",
    "decoding",
  ]);
  const imageTags = new Set(["img", "source"]);
  // Lightbox links now point at build-time derivatives (Stage 6), so their
  // href changes by design; every other attribute is still compared.
  const imageLinkTags = new Set(["a"]);

  function normaliseNode(node) {
    if (node.nodeType === Node.COMMENT_NODE) {
      return null;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue ?? "";
      const parentTag = node.parentElement?.tagName.toLowerCase();

      if (parentTag && ignoredTags.has(parentTag)) {
        return value.replace(/\r\n?/g, "\n").trim();
      }

      return value.replace(/\s+/g, " ").trim();
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    if (ignoredTags.has(node.tagName.toLowerCase())) {
      return null;
    }

    const tagName = node.tagName.toLowerCase();
    const isImageLink = imageLinkTags.has(tagName) && node.hasAttribute("data-lightbox");
    const attributes = [...node.attributes]
      .filter(
        (attribute) =>
          attribute.name !== "style" &&
          !attribute.name.startsWith("on") &&
          !ignoredEventAttributes.has(attribute.name) &&
          !(imageTags.has(tagName) && ignoredImageAttributes.has(attribute.name)) &&
          !(isImageLink && attribute.name === "href"),
      )
      .map((attribute) => {
        if (attribute.name !== "class") {
          return [attribute.name, attribute.value];
        }

        const filteredClasses = attribute.value
          .split(/\s+/)
          .filter((className) => className && !ignoredCssClasses.has(className))
          .join(" ");
        return filteredClasses ? ["class", filteredClasses] : null;
      })
      .filter(Boolean)
      .sort(([left], [right]) => left.localeCompare(right));
    const children = [...node.childNodes]
      .map(normaliseNode)
      .filter((child) => child !== null && child !== "");

    return {
      tag: tagName,
      attributes,
      children,
    };
  }

  return {
    doctype: document.doctype
      ? {
          name: document.doctype.name,
          publicId: document.doctype.publicId,
          systemId: document.doctype.systemId,
        }
      : null,
    documentElement: normaliseNode(document.documentElement),
  };
}

async function normaliseHtml(page, html) {
  return page.evaluate(
    ({ source, normaliseDocumentSource }) => {
      // DOMParser parses synchronously and never fetches subresources, so the
      // comparison cannot be disturbed by external scripts or fonts loading.
      const parsed = new DOMParser().parseFromString(source, "text/html");
      return Function(`return (${normaliseDocumentSource})`)().call(null, parsed);
    },
    {
      source: html,
      normaliseDocumentSource: normaliseDocument.toString(),
    },
  );
}

function getActiveNavigation(html) {
  return [...html.matchAll(/<a\b[^>]*>/gi)]
    .filter((match) => /\bclass=["'][^"']*\bactive\b[^"']*["']/i.test(match[0]))
    .map((match) => match[0].match(/\bhref=["']([^"']+)["']/i)?.[1])
    .filter(Boolean);
}

test("generated site preserves Stage 2A structure and production assets", async (
  { page },
  testInfo,
) => {
  test.skip(testInfo.project.name !== "desktop", "Build checks run once on desktop");

  const pageMismatches = [];
  for (const sitePage of SITE_PAGES) {
    const relativePath = decodeURIComponent(sitePage.path.replace(/^\//, ""));
    const snapshotPath = path.join(stageTwoASnapshotRoot, "html", relativePath);
    const outputPath = path.join(SITE_ROOT, relativePath);

    if (!existsSync(snapshotPath)) {
      pageMismatches.push(`${sitePage.path}: Stage 2A snapshot is missing`);
      continue;
    }

    if (!existsSync(outputPath)) {
      pageMismatches.push(`${sitePage.path}: generated file is missing`);
      continue;
    }

    const [snapshotHtml, outputHtml] = await Promise.all([
      readFile(snapshotPath, "utf8"),
      readFile(outputPath, "utf8"),
    ]);
    // Rendered sequentially: both calls reuse one page via document.write, so
    // running them concurrently corrupts the comparison.
    const snapshotStructure = await normaliseHtml(page, snapshotHtml);
    const outputStructure = await normaliseHtml(page, outputHtml);

    if (JSON.stringify(snapshotStructure) !== JSON.stringify(outputStructure)) {
      pageMismatches.push(`${sitePage.path}: generated DOM structure differs`);
    }

    const expectedActive =
      expectedActiveNavigation[sitePage.name] === ""
        ? []
        : [expectedActiveNavigation[sitePage.name]];
    const actualActive = getActiveNavigation(outputHtml);
    if (JSON.stringify(actualActive) !== JSON.stringify(expectedActive)) {
      pageMismatches.push(
        `${sitePage.path}: active navigation was ${JSON.stringify(actualActive)}, expected ${JSON.stringify(expectedActive)}`,
      );
    }
  }

  expect(pageMismatches).toEqual([]);

  const imageStats = await verifyImageDeployment();
  const downloadFiles = await collectRelativeFiles(path.join(SITE_ROOT, "downloads"));

  // Stage 6 guard rails: the deployed artifact must stay deployable on GitHub
  // Pages and must not regress back to shipping the full-resolution archive.
  const artifactBytes = (
    await Promise.all(
      (await collectRelativeFiles(SITE_ROOT)).map(
        async (relativePath) => (await stat(path.join(SITE_ROOT, relativePath))).size,
      ),
    )
  ).reduce((total, bytes) => total + bytes, 0);

  expect(artifactBytes / 1024 ** 2).toBeLessThan(400);
  expect(imageStats.deployedBytes / 1024 ** 2).toBeLessThan(350);

  const forbiddenPaths = [
    ".github",
    ".gitignore",
    "_includes",
    "eleventy.config.js",
    "node_modules",
    "package.json",
    "package-lock.json",
    "playwright.config.js",
    "playwright-report",
    "reports",
    "test-results",
    "tests",
    "tools",
  ];
  const leakedDevelopmentPaths = forbiddenPaths.filter((entry) =>
    existsSync(path.join(SITE_ROOT, entry)),
  );

  expect(leakedDevelopmentPaths).toEqual([]);

  await writeMeasurement("build-output", {
    publicPageCount: SITE_PAGES.length,
    sourceImageCount: imageStats.originalCount,
    deployedImageCount: imageStats.derivativeCount + imageStats.copiedOriginalCount,
    deployedDerivativeCount: imageStats.derivativeCount,
    deployedCopiedOriginalCount: imageStats.copiedOriginalCount,
    deployedImageBytes: imageStats.deployedBytes,
    artifactBytes,
    copiedDownloadCount: downloadFiles.length,
    generatedRoot: path.relative(SOURCE_ROOT, SITE_ROOT),
    leakedDevelopmentPaths,
    stageTwoASnapshotRoot: path.relative(SOURCE_ROOT, stageTwoASnapshotRoot),
  });
});
