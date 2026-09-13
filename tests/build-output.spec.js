import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { writeMeasurement } from "./helpers/baseline.mjs";
import { SITE_ROOT, SOURCE_ROOT } from "./helpers/site-root.mjs";
import { SITE_PAGES } from "./helpers/site-pages.mjs";

async function sha256(filePath) {
  const contents = await readFile(filePath);
  return createHash("sha256").update(contents).digest("hex");
}

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

test("generated site preserves public paths and production assets", async (
  {},
  testInfo,
) => {
  test.skip(testInfo.project.name !== "desktop", "Build checks run once on desktop");

  const pageMismatches = [];
  for (const sitePage of SITE_PAGES) {
    const relativePath = decodeURIComponent(sitePage.path.replace(/^\//, ""));
    const sourcePath = path.join(SOURCE_ROOT, relativePath);
    const outputPath = path.join(SITE_ROOT, relativePath);

    if (!existsSync(outputPath)) {
      pageMismatches.push(`${sitePage.path}: generated file is missing`);
      continue;
    }

    const [sourceHash, outputHash] = await Promise.all([
      sha256(sourcePath),
      sha256(outputPath),
    ]);

    if (sourceHash !== outputHash) {
      pageMismatches.push(`${sitePage.path}: source and generated HTML differ`);
    }
  }

  expect(pageMismatches).toEqual([]);

  const stylesheetMismatch = (await sha256(path.join(SOURCE_ROOT, "styles.css"))) !==
    (await sha256(path.join(SITE_ROOT, "styles.css")));
  const scriptMismatch = (await sha256(path.join(SOURCE_ROOT, "script.js"))) !==
    (await sha256(path.join(SITE_ROOT, "script.js")));

  expect({ stylesheetMismatch, scriptMismatch }).toEqual({
    stylesheetMismatch: false,
    scriptMismatch: false,
  });

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
  });
});
