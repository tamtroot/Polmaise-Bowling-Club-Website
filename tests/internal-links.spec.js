import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "@playwright/test";
import { compareOrUpdateBaseline, writeMeasurement } from "./helpers/baseline.mjs";
import { SITE_ROOT } from "./helpers/site-root.mjs";
import { SITE_PAGES } from "./helpers/site-pages.mjs";

const projectRoot = SITE_ROOT;

/**
 * Baseline fingerprints must read the same on every platform: `path.relative`
 * returns Windows separators locally and POSIX separators on the Linux CI
 * runner, which made baselined entries look "new" in CI.
 */
const posixRelative = (target) => path.relative(projectRoot, target).split(path.sep).join("/");

const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "playwright-report",
  "reports",
  "test-results",
  "tests",
  "tools",
]);

async function findFiles(directory, extensions) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findFiles(fullPath, extensions)));
    } else if (extensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }

  return files;
}

function isIgnoredReference(reference) {
  const value = reference.trim();
  return (
    !value ||
    value.startsWith("#") ||
    value.startsWith("%23") ||
    /^(?:data|blob|mailto|tel|javascript):/i.test(value) ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
  );
}

function resolveCssReference(sourceFile, reference) {
  if (isIgnoredReference(reference)) {
    return null;
  }

  const cleanReference = reference.split("#")[0].split("?")[0];
  if (!cleanReference) {
    return null;
  }

  let decodedReference;
  try {
    decodedReference = decodeURIComponent(cleanReference);
  } catch {
    decodedReference = cleanReference;
  }

  return path.resolve(path.dirname(sourceFile), decodedReference);
}

async function collectCssLinkFailures() {
  const failures = [];
  const checked = [];
  const htmlFiles = await findFiles(projectRoot, new Set([".html", ".css"]));
  const cssUrlPattern = /url\(\s*(["']?)([^)"']+)\1\s*\)/gi;

  for (const sourceFile of htmlFiles) {
    const source = await readFile(sourceFile, "utf8");
    const styleBlocks =
      path.extname(sourceFile).toLowerCase() === ".html"
        ? [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
            .map((match) => match[1])
            .join("\n")
        : source;

    for (const match of styleBlocks.matchAll(cssUrlPattern)) {
      const reference = match[2];
      const resolved = resolveCssReference(sourceFile, reference);
      if (!resolved) {
        continue;
      }

      const relativeSource = posixRelative(sourceFile);
      const relativeTarget = posixRelative(resolved);
      checked.push(relativeTarget);

      if (!existsSync(resolved)) {
        failures.push(`CSS ${relativeSource} -> ${reference} -> ${relativeTarget}`);
      }
    }
  }

  return { checked: [...new Set(checked)].sort(), failures: [...new Set(failures)].sort() };
}

function resolveDomReference(baseURL, reference) {
  if (!reference) {
    return null;
  }

  let url;
  try {
    url = new URL(reference, baseURL);
  } catch {
    return null;
  }

  if (url.origin !== new URL(baseURL).origin) {
    return null;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    pathname = url.pathname;
  }

  if (pathname.endsWith("/")) {
    pathname += "index.html";
  }

  return path.resolve(projectRoot, `.${pathname}`);
}

test("all public page and stylesheet references resolve", async (
  { page, baseURL },
  testInfo,
) => {
  test.skip(testInfo.project.name !== "desktop", "Link checks run once on desktop");

  const domLinkFailures = [];
  const placeholderLinks = [];
  let checkedReferenceCount = 0;

  for (const sitePage of SITE_PAGES) {
    await page.goto(sitePage.path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(150);

    const references = await page.evaluate(() => {
      const values = [];

      for (const element of document.querySelectorAll("[href], [src]")) {
        for (const attribute of ["href", "src"]) {
          if (!element.hasAttribute(attribute)) {
            continue;
          }

          const raw = element.getAttribute(attribute);
          if (raw === null) {
            continue;
          }

          let resolved = raw;
          try {
            resolved = new URL(raw, document.baseURI).href;
          } catch {
            // Keep the raw value so the Node-side checker can report it.
          }

          values.push({
            tag: element.tagName.toLowerCase(),
            attribute,
            raw,
            resolved,
          });
        }
      }

      return values;
    });

    for (const reference of references) {
      if (reference.raw === "#" || reference.raw === "") {
        placeholderLinks.push(
          `${sitePage.path} -> <${reference.tag} ${reference.attribute}="${reference.raw}">`,
        );
      }

      const resolved = resolveDomReference(baseURL, reference.resolved);
      if (!resolved) {
        continue;
      }

      checkedReferenceCount += 1;
      if (!existsSync(resolved)) {
        domLinkFailures.push(
          `${sitePage.path} -> <${reference.tag} ${reference.attribute}="${reference.raw}"> -> ${posixRelative(resolved)}`,
        );
      }
    }
  }

  const cssReport = await collectCssLinkFailures();
  const failures = [...new Set([...domLinkFailures, ...cssReport.failures])].sort();

  await compareOrUpdateBaseline(testInfo, "internal-links/missing-targets", failures);
  await compareOrUpdateBaseline(
    testInfo,
    "internal-links/placeholder-links",
    [...new Set(placeholderLinks)].sort(),
  );
  await writeMeasurement("internal-links", {
    publicPageCount: SITE_PAGES.length,
    checkedDomReferenceCount: checkedReferenceCount,
    checkedCssTargetCount: cssReport.checked.length,
    missingTargetCount: failures.length,
    placeholderLinkCount: new Set(placeholderLinks).size,
  });
});
