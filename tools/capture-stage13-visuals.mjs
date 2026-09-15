import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createStaticServer } from "./static-server.mjs";

/**
 * Stage 13 visual review capture.
 *
 * The news section became 50+ generated pages in Stage 13, so the review set is
 * explicit rather than "every page in SITE_PAGES": the landing page, a
 * representative article from each section, and the archive/category indexes.
 *
 * For each page it records the things a reviewer cannot eyeball across a
 * hundred images: horizontal overflow, broken images, console/page errors and
 * whether any article title block is still following the reader (position:
 * sticky/fixed) while the page scrolls.
 *
 * PNGs are written outside the repository (OUTPUT_DIR); JSON findings go to
 * reports/stage13/.
 */
const root = process.cwd();
const siteRoot = path.resolve(root, process.env.SITE_ROOT ?? "_site");
const outputDirectory = path.resolve(
  process.env.OUTPUT_DIR ?? path.join(process.env.TEMP ?? process.env.TMP ?? root, "polmaise-stage13-visuals"),
);
const port = 4187;

const REVIEW_PAGES = [
  { name: "news-landing", path: "/news.html" },
  { name: "news-article-2026", path: "/news/2026/chucks-memorial-2026/index.html" },
  { name: "news-article-2025", path: "/news/2025/charlie-mcneil-2025/index.html" },
  { name: "news-article-history", path: "/news/history/1911-opening-of-bowling-green-and-sale-of/index.html" },
  { name: "news-archive-2026", path: "/news/2026/index.html" },
  { name: "news-archive-2025", path: "/news/2025/index.html" },
  { name: "news-archive-history", path: "/news/history/index.html" },
  { name: "news-category-competition", path: "/news/category/competition/index.html" },
  { name: "home", path: "/index.html" },
];

const viewports = [
  { name: "wide", width: 1440, height: 900 },
  { name: "laptop", width: 1024, height: 768 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];

// Optional filters for a quick iteration pass, e.g.
//   PAGES=news-landing VIEWPORTS=mobile node tools/capture-stage13-visuals.mjs
const filter = (value) => (process.env[value] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
const pageFilter = filter("PAGES");
const viewportFilter = filter("VIEWPORTS");
const reviewSet = pageFilter.length
  ? REVIEW_PAGES.filter((reviewPage) => pageFilter.includes(reviewPage.name))
  : REVIEW_PAGES;
const viewportSet = viewportFilter.length
  ? viewports.filter((viewport) => viewportFilter.includes(viewport.name))
  : viewports;

const server = createStaticServer(siteRoot);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const browser = await chromium.launch();
const report = {
  generatedAt: new Date().toISOString(),
  siteRoot,
  outputDirectory,
  captures: [],
  findings: {
    horizontalOverflow: [],
    brokenImages: [],
    consoleErrors: [],
    pageErrors: [],
    stickyTitles: [],
  },
};

/**
 * Scrolls an article page and reports whether its title block stayed pinned to
 * the viewport (the Stage 13 sticky-title defect).
 */
const probeTitleBehaviour = (page) =>
  page.evaluate(async () => {
    const heading = document.querySelector(".article-header h2");
    if (!heading) return null;
    const before = heading.getBoundingClientRect();
    const style = getComputedStyle(heading.closest(".article-header"));
    const pageHeight = document.documentElement.scrollHeight;
    const distance = Math.min(pageHeight - window.innerHeight, window.innerHeight * 2);
    window.scrollTo(0, distance);
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const after = heading.getBoundingClientRect();
    const scrolled = window.scrollY;
    return {
      position: style.position,
      topBefore: Math.round(before.top),
      topAfter: Math.round(after.top),
      documentTopAfter: Math.round(after.top + scrolled),
      viewportTopAfter: Math.round(after.top),
      // A title in normal document flow keeps its document offset; a sticky or
      // fixed panel keeps its viewport offset instead.
      movedWithDocument: Math.abs(after.top + scrolled - before.top) < 2,
    };
  });

/**
 * Geometry of the article furniture: the header block, the hero and the
 * previous/next navigation. Recorded so the review can prove the title is not
 * overlaying the hero and that the nav links stay readable at every width.
 */
const probeArticleLayout = (page) =>
  page.evaluate(() => {
    const describe = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top + window.scrollY),
        position: style.position,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
      };
    };

    const nav = document.querySelector(".article-nav");
    const navLinks = nav
      ? [...nav.querySelectorAll("a")].map((link) => ({
          text: link.textContent.trim().replace(/\s+/g, " ").slice(0, 48),
          width: Math.round(link.getBoundingClientRect().width),
          maxWidth: getComputedStyle(link).maxWidth,
          display: getComputedStyle(link).display,
        }))
      : [];
    const navParent = nav?.parentElement;

    const header = document.querySelector(".article-header");
    const hero = document.querySelector(".article-hero");
    const headerRect = header?.getBoundingClientRect();
    const heroRect = hero?.getBoundingClientRect();

    return {
      nav: describe(".article-nav"),
      header: describe(".article-header"),
      heading: describe(".article-header h2"),
      hero: describe(".article-hero"),
      body: describe(".article-body"),
      navDirection: nav ? getComputedStyle(nav).flexDirection : null,
      navWidth: nav ? Math.round(nav.getBoundingClientRect().width) : null,
      navOffsetWidth: nav?.offsetWidth ?? null,
      navMaxWidth: nav ? getComputedStyle(nav).maxWidth : null,
      navLinks,
      navParent: navParent
        ? {
            className: navParent.className,
            display: getComputedStyle(navParent).display,
            width: Math.round(navParent.getBoundingClientRect().width),
          }
        : null,
      navPath: nav
        ? (() => {
            const path = [];
            let node = nav.parentElement;
            while (node && node !== document.body) {
              path.push(`${node.tagName.toLowerCase()}${node.className ? `.${String(node.className).split(" ").join(".")}` : ""}`);
              node = node.parentElement;
            }
            return path;
          })()
        : null,
      headerHeroOverlap:
        headerRect && heroRect
          ? Math.round(Math.max(0, Math.min(headerRect.bottom, heroRect.bottom) - Math.max(headerRect.top, heroRect.top)))
          : null,
    };
  });

const probeOverflow = (page) =>
  page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
    brokenImages: [...document.images]
      .filter((image) => image.complete && image.naturalWidth === 0 && image.getBoundingClientRect().width > 0)
      .map((image) => image.getAttribute("src")),
  }));

try {
  for (const reviewPage of reviewSet) {
    for (const viewport of viewportSet) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
      });

      for (const theme of ["day", "night"]) {
        const page = await context.newPage();
        const consoleErrors = [];
        const pageErrors = [];
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text());
        });
        page.on("pageerror", (error) => pageErrors.push(error.message));

        if (theme === "night") {
          await page.addInitScript(() => {
            try {
              window.localStorage.setItem("polmaise-theme", "dark");
            } catch (error) {
              /* storage unavailable */
            }
          });
        }

        await page.clock.setFixedTime(new Date("2026-09-13T12:00:00Z"));
        await page.goto(`http://127.0.0.1:${port}${reviewPage.path}`, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(async () => {
          const step = Math.round(window.innerHeight * 0.8);
          for (let y = 0; y < document.body.scrollHeight; y += step) {
            window.scrollTo(0, y);
            await new Promise((resolve) => requestAnimationFrame(() => resolve()));
          }
          window.scrollTo(0, 0);
          const images = [...document.images];
          for (const image of images) image.loading = "eager";
          await Promise.all(
            images
              .filter((image) => !image.complete)
              .map((image) => image.decode().catch(() => {})),
          );
        });
        await page.waitForTimeout(300);

        const directory = path.join(outputDirectory, theme);
        await mkdir(directory, { recursive: true });
        const file = path.join(directory, `${reviewPage.name}-${viewport.name}.png`);
        await page.screenshot({ path: file, fullPage: true });

        const overflow = await probeOverflow(page);
        const titleBehaviour = await probeTitleBehaviour(page);
        const articleLayout = await probeArticleLayout(page);

        report.captures.push({
          page: reviewPage.name,
          path: reviewPage.path,
          viewport: viewport.name,
          theme,
          file: path.relative(root, file).split(path.sep).join("/"),
          ...overflow,
          titleBehaviour,
          articleLayout,
          consoleErrors,
          pageErrors,
        });

        if (overflow.horizontalOverflow > 1) {
          report.findings.horizontalOverflow.push({
            page: reviewPage.path,
            viewport: viewport.name,
            theme,
            overflow: Math.round(overflow.horizontalOverflow),
          });
        }
        if (overflow.brokenImages.length) {
          report.findings.brokenImages.push({
            page: reviewPage.path,
            viewport: viewport.name,
            theme,
            images: overflow.brokenImages.slice(0, 5),
          });
        }
        if (titleBehaviour && !titleBehaviour.movedWithDocument) {
          report.findings.stickyTitles.push({
            page: reviewPage.path,
            viewport: viewport.name,
            theme,
            ...titleBehaviour,
          });
        }
        if (consoleErrors.length) {
          report.findings.consoleErrors.push({
            page: reviewPage.path,
            viewport: viewport.name,
            theme,
            messages: consoleErrors.slice(0, 5),
          });
        }
        if (pageErrors.length) {
          report.findings.pageErrors.push({
            page: reviewPage.path,
            viewport: viewport.name,
            theme,
            messages: pageErrors.slice(0, 5),
          });
        }

        console.log(`captured ${reviewPage.path} @ ${viewport.name} (${theme})`);
        await page.close();
      }

      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

const reportRoot = path.join(root, "reports", "stage13");
await mkdir(reportRoot, { recursive: true });
await writeFile(
  path.join(reportRoot, "visual-review.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);

console.log(`\nCaptures: ${report.captures.length}`);
console.log(
  JSON.stringify(
    {
      horizontalOverflow: report.findings.horizontalOverflow.length,
      brokenImages: report.findings.brokenImages.length,
      consoleErrors: report.findings.consoleErrors.length,
      pageErrors: report.findings.pageErrors.length,
      stickyTitles: report.findings.stickyTitles.length,
    },
    null,
    2,
  ),
);
console.log(`Wrote reports/stage13/visual-review.json and screenshots to ${outputDirectory}`);
