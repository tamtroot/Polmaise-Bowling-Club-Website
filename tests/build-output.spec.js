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
    if (entry.isDirectory()) {
      files.push(...(await collectRelativeFiles(fullPath, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

async function compareFileTrees(sourceDirectory, outputDirectory) {
  const sourceFiles = await collectRelativeFiles(sourceDirectory);
  const outputFiles = await collectRelativeFiles(outputDirectory);
  const mismatches = [];

  expect(outputFiles.sort()).toEqual(sourceFiles.sort());

  for (const relativePath of sourceFiles) {
    const sourcePath = path.join(sourceDirectory, relativePath);
    const outputPath = path.join(outputDirectory, relativePath);
    const sourceStat = await stat(sourcePath);
    const outputStat = await stat(outputPath);

    if (sourceStat.size !== outputStat.size) {
      mismatches.push(
        `${relativePath}: expected ${sourceStat.size} bytes, received ${outputStat.size}`,
      );
    }
  }

  expect(mismatches).toEqual([]);
  return sourceFiles;
}

function normaliseDocument() {
  const ignoredTags = new Set(["script", "style"]);
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

    if (node.tagName.toLowerCase() === "style") {
      return null;
    }

    const attributes = [...node.attributes]
      .filter((attribute) => attribute.name !== "style")
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
      tag: node.tagName.toLowerCase(),
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
      document.open();
      document.write(source);
      document.close();
      return Function(`return (${normaliseDocumentSource})`)()();
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
    const [snapshotStructure, outputStructure] = await Promise.all([
      normaliseHtml(page, snapshotHtml),
      normaliseHtml(page, outputHtml),
    ]);

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

  const imageFiles = await compareFileTrees(
    path.join(SOURCE_ROOT, "Images"),
    path.join(SITE_ROOT, "Images"),
  );
  const downloadFiles = await compareFileTrees(
    path.join(SOURCE_ROOT, "downloads"),
    path.join(SITE_ROOT, "downloads"),
  );

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
    copiedImageCount: imageFiles.length,
    copiedDownloadCount: downloadFiles.length,
    generatedRoot: path.relative(SOURCE_ROOT, SITE_ROOT),
    leakedDevelopmentPaths,
    stageTwoASnapshotRoot: path.relative(SOURCE_ROOT, stageTwoASnapshotRoot),
  });
});
