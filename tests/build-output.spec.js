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
  // Stage 13 news pages: the site header highlights News & Events.
  "news-article-2026": "../../../news.html",
  "news-article-2025": "../../../news.html",
  "news-article-history": "../../../news.html",
  "news-archive-2026": "../../news.html",
  "news-archive-2025": "../../news.html",
  "news-archive-history": "../../news.html",
  "news-category-competition": "../../../news.html",
};

/**
 * Pages that did not exist when the Stage 2A snapshot was taken, so there is no
 * historical DOM to compare them against. The homepage was redesigned in Stage
 * 12 and the news section became a generated set of pages in Stage 13; both are
 * covered by their own specs (tests/homepage.spec.js, tests/homepage-fixtures
 * .spec.js, tests/news-architecture.spec.js) and by visual baselines.
 * Stage 14 rebuilt the fixtures page around the season summary, month groups
 * and the collapsible completed fixtures (tests/fixtures-ux.spec.js).
 */
const pagesWithoutStageTwoASnapshot = new Set([
  "home",
  // Stage 13 rebuilt news.html as an editorial front page (featured story,
  // latest, more news, categories, archives) instead of the single long page
  // the snapshot describes; tests/news-architecture.spec.js covers it.
  "news",
  "fixtures",
  "news-article-2026",
  "news-article-2025",
  "news-article-history",
  "news-archive-2026",
  "news-archive-2025",
  "news-archive-history",
  "news-category-competition",
]);

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
  // Adjacent text nodes read as one piece of text to a human and to a browser
  // layout, so merge them before comparing.
  function mergeAdjacentText(children) {
    return children.reduce((merged, child) => {
      const previous = merged[merged.length - 1];
      if (typeof child === "string" && typeof previous === "string") {
        merged[merged.length - 1] = `${previous} ${child}`.trim();
        return merged;
      }
      merged.push(child);
      return merged;
    }, []);
  }

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
    // Stage 7 gives the placeholder social icons a decorative class so they
    // are no longer announced as links.
    "social-link",
    // Stage 9 replaces inline `style` attributes with named classes (the
    // comparison already ignores `style`) and adds presentation hooks that do
    // not change the structure or content of the page.
    "is-hidden",
    "news-figure",
    "news-figcaption",
    "plain-list",
    "plain-list--inset",
    "plain-list--flush",
    "news-cta",
    "history-feature-row",
    "history-feature-figure",
    "looking-back-row",
    "looking-back-text",
    "looking-back-figure",
    "figure-reset",
    "history-table-total",
    "history-table-total-value",
    "history-float-figure",
    "history-thumb-stack",
    "committee-members--spaced",
    "cta-heading",
    "cta-button-label",
    "closing-quote",
    // Icon-font classes are presentational. Stage 10 swapped the square
    // Facebook tile (whose "f" is negative space and vanished on the navy
    // circle) for the standalone "f" glyph.
    "fa-facebook",
    "fa-facebook-f",
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
  // Stage 7 made clickable cards keyboard operable: they are now <button>,
  // <a> or <section> elements with ARIA attributes. The element structure,
  // classes and content are still compared; these attributes are the
  // intentional accessibility additions.
  const ignoredAccessibilityAttributes = new Set(["role", "tabindex"]);
  const isAriaAttribute = (name) => name.startsWith("aria-");
  // Ids created for aria-controls/aria-labelledby wiring.
  const accessibilityIdPattern =
    /^(?:primary-menu|mobileMenuButton|faq-\d+-(?:header|content)|password-hint)$/;
  // Controls that were upgraded to a semantic element, keyed by class.
  const semanticTagAliases = new Map([
    ["mobile-menu", "div"],
    ["accordion-header", "div"],
    ["accordion-content", "div"],
    ["album-card", "div"],
    ["news-card", "div"],
    ["fees-table-container", "div"],
  ]);
  const linkCardClasses = ["album-card", "news-card"];
  // Metadata declarations (SEO tags) are ignored; <title> is still compared.
  const ignoredMetadataTags = new Set(["meta", "link"]);

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

    if (ignoredMetadataTags.has(node.tagName.toLowerCase())) {
      return null;
    }

    const realTag = node.tagName.toLowerCase();
    const classes = node.classList ?? [];

    // Stage 7 removed placeholder links (href="#" / href="") because they had
    // no destination, and Stage 8 turned the broken login.html link into text;
    // those anchors are compared by their text content only.
    const placeholderHrefs = new Set(["#", "", "login.html"]);
    const href = node.getAttribute("href");
    // Stage 9 adds a day/night theme toggle to the shared header: a new control,
    // not a change to existing structure, so it is not part of the comparison.
    if (classes.contains("theme-toggle")) {
      return null;
    }
    // Controls whose placeholder link was replaced by a real element (the
    // social icons became decorative, the ticket link became a button) are
    // compared by their content only.
    const isUpgradedPlaceholder =
      classes.contains("social-link") || classes.contains("cta-button");
    if ((realTag === "a" && placeholderHrefs.has(href)) || isUpgradedPlaceholder) {
      return {
        fragment: true,
        children: mergeAdjacentText(
          [...node.childNodes]
            .map(normaliseNode)
            .flatMap((child) => (child && child.fragment ? child.children : [child]))
            .filter((child) => child !== null && child !== ""),
        ),
      };
    }

    const alias = [...semanticTagAliases.keys()].find((className) => classes.contains(className));
    const tagName = alias ? semanticTagAliases.get(alias) : realTag;

    // The Stage 7 <main> landmark wraps existing content without changing it.
    if (tagName === "main") {
      const children = mergeAdjacentText(
        [...node.childNodes]
          .map(normaliseNode)
          .flatMap((child) => (child && child.fragment ? child.children : [child]))
          .filter((child) => child !== null && child !== ""),
      );
      return { fragment: true, children };
    }

    const isImageLink = imageLinkTags.has(realTag) && node.hasAttribute("data-lightbox");
    const isLinkCard = imageLinkTags.has(realTag) && linkCardClasses.some((className) => classes.contains(className));
    const attributes = [...node.attributes]
      .filter(
        (attribute) =>
          attribute.name !== "style" &&
          !attribute.name.startsWith("on") &&
          !ignoredEventAttributes.has(attribute.name) &&
          !ignoredAccessibilityAttributes.has(attribute.name) &&
          !isAriaAttribute(attribute.name) &&
          !(attribute.name === "id" && accessibilityIdPattern.test(attribute.value)) &&
          !(imageTags.has(tagName) && ignoredImageAttributes.has(attribute.name)) &&
          !((isImageLink || isLinkCard) && attribute.name === "href") &&
          // Elements upgraded to a semantic element also gain its attributes.
          !(alias && (attribute.name === "type" || attribute.name === "href")),
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
    const children = mergeAdjacentText(
      [...node.childNodes]
        .map(normaliseNode)
        .flatMap((child) => (child && child.fragment ? child.children : [child]))
        .filter((child) => child !== null && child !== ""),
    );

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

/**
 * Describes where two normalised structures first differ, so a failure points
 * at the node instead of just naming the page.
 */
function describeFirstDifference(snapshot, output, nodePath = "html") {
  const left = JSON.stringify(snapshot);
  const right = JSON.stringify(output);
  if (left === right) {
    return null;
  }

  if (typeof snapshot === "string" || typeof output === "string") {
    return `${nodePath}: text ${JSON.stringify(snapshot)} vs ${JSON.stringify(output)}`;
  }
  if (!snapshot || !output) {
    return `${nodePath}: node missing on one side`;
  }
  if (snapshot.tag !== output.tag) {
    return `${nodePath}: <${snapshot.tag}> vs <${output.tag}>`;
  }
  if (JSON.stringify(snapshot.attributes) !== JSON.stringify(output.attributes)) {
    return `${nodePath}>${snapshot.tag}: ${JSON.stringify(snapshot.attributes)} vs ${JSON.stringify(output.attributes)}`;
  }
  if (snapshot.children.length !== output.children.length) {
    return `${nodePath}>${snapshot.tag}: ${snapshot.children.length} vs ${output.children.length} children (${snapshot.children.map((child) => (typeof child === "string" ? `#${child}` : child.tag)).join(",")} vs ${output.children.map((child) => (typeof child === "string" ? `#${child}` : child.tag)).join(",")})`;
  }

  for (let index = 0; index < snapshot.children.length; index += 1) {
    const difference = describeFirstDifference(
      snapshot.children[index],
      output.children[index],
      `${nodePath}>${snapshot.tag}[${index}]`,
    );
    if (difference) {
      return difference;
    }
  }

  return `${nodePath}: differs beyond the child comparison`;
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

    /*
     * Stage 12 deliberately redesigned the homepage: it now carries the
     * editorial sections (hero, feature strip, news, schedule, history,
     * gallery, membership, sponsors) instead of the original hero + welcome +
     * quick-links blocks, so the Stage 2A snapshot no longer describes it. The
     * homepage is covered by `tests/homepage.spec.js` (sections, data states,
     * links, responsive overflow) and by the visual baselines. Every other page
     * is still compared exactly.
     */
    if (!pagesWithoutStageTwoASnapshot.has(sitePage.name)) {
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
        const doctypeDifference =
          JSON.stringify(snapshotStructure.doctype) !== JSON.stringify(outputStructure.doctype)
            ? `doctype ${JSON.stringify(snapshotStructure.doctype)} vs ${JSON.stringify(outputStructure.doctype)}`
            : null;
        pageMismatches.push(
          `${sitePage.path}: generated DOM structure differs at ${
            doctypeDifference ??
            describeFirstDifference(snapshotStructure.documentElement, outputStructure.documentElement)
          }`,
        );
      }
    }

    const outputHtml = await readFile(outputPath, "utf8");
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

  /*
   * Stage 14 guard: a generated root must never be read back as input. When a
   * sibling output directory (another SITE_ROOT) is treated as source, every
   * page of it is re-rendered into the artifact and builds get progressively
   * slower; this fails if any nested site root appears in the output.
   */
  const nestedSiteRoots = (await readdir(SITE_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("_site"))
    .map((entry) => entry.name);

  expect(nestedSiteRoots).toEqual([]);

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
