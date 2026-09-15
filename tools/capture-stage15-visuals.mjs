import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium } from "playwright";
import { createStaticServer } from "./static-server.mjs";

/**
 * Stage 15 review capture: the historical archive, one representative
 * historical article and the club History page, at four widths in both themes.
 *
 * Records the things a reviewer cannot eyeball across 24 screen shots:
 * horizontal overflow, broken images, console/page errors and axe violations
 * (WCAG 2.0/2.1 A + AA), plus the archive's own shape — how many year markers
 * and story rows it renders.
 *
 * PNGs go outside the repository (OUTPUT_DIR); JSON to
 * reports/stage15/visual-review.json.
 */
const root = process.cwd();
const siteRoot = path.resolve(root, process.env.SITE_ROOT ?? "_site");
const outputDirectory = path.resolve(
  process.env.OUTPUT_DIR ??
    path.join(process.env.TEMP ?? process.env.TMP ?? root, "polmaise-stage15-visuals"),
);
const port = 4190;

const require = createRequire(import.meta.url);
const axeSource = require("axe-core").source;

const targets = [
  { name: "historical-archive", path: "/news/history/index.html" },
  {
    name: "historical-article",
    path: "/news/history/1911-opening-of-bowling-green-and-sale-of/index.html",
  },
  { name: "history-page", path: "/history.html" },
];

const viewports = [
  { name: "wide", width: 1440, height: 900 },
  { name: "laptop", width: 1024, height: 768 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];

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
    axeViolations: [],
    consoleErrors: [],
    pageErrors: [],
  },
};

const probe = (page) =>
  page.evaluate(() => {
    const archive = document.querySelector(".archive");
    const rows = archive ? [...archive.querySelectorAll(".archive-row")] : [];
    const visible = (element) => {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    return {
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      brokenImages: [...document.images]
        .filter(
          (image) =>
            image.complete && image.naturalWidth === 0 && image.getBoundingClientRect().width > 0,
        )
        .map((image) => image.getAttribute("src")),
      years: archive ? [...archive.querySelectorAll(".archive-year-label")].map((label) => label.textContent.trim()) : [],
      rows: rows.length,
      visibleRows: rows.filter(visible).length,
      yearsWithMultipleRows: archive
        ? [...archive.querySelectorAll(".archive-year")].map(
            (section) => section.querySelectorAll(".archive-row").length,
          )
        : [],
      scrollHeight: document.documentElement.scrollHeight,
    };
  });

try {
  for (const target of targets) {
    for (const viewport of viewports) {
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
        await page.goto(`http://127.0.0.1:${port}${target.path}`, { waitUntil: "domcontentloaded" });
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
            images.filter((image) => !image.complete).map((image) => image.decode().catch(() => {})),
          );
        });
        await page.waitForTimeout(250);

        const diagnostics = await probe(page);

        await page.addScriptTag({ content: axeSource }).catch(() => {});
        const axeViolations = await page.evaluate(async () => {
          const results = await window.axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
          });
          return results.violations.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            nodeCount: violation.nodes.length,
            targets: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
          }));
        });

        const directory = path.join(outputDirectory, theme);
        await mkdir(directory, { recursive: true });
        const file = path.join(directory, `${target.name}-${viewport.name}.png`);
        await page.screenshot({ path: file, fullPage: true });

        report.captures.push({
          page: target.name,
          path: target.path,
          viewport: viewport.name,
          theme,
          file: path.relative(root, file).split(path.sep).join("/"),
          ...diagnostics,
          axeViolations,
          consoleErrors,
          pageErrors,
        });

        const push = (key, value) => report.findings[key].push({ page: target.path, viewport: viewport.name, theme, ...value });
        if (diagnostics.horizontalOverflow > 1) {
          push("horizontalOverflow", { overflow: Math.round(diagnostics.horizontalOverflow) });
        }
        if (diagnostics.brokenImages.length) {
          push("brokenImages", { images: diagnostics.brokenImages.slice(0, 5) });
        }
        if (axeViolations.length) push("axeViolations", { violations: axeViolations });
        if (consoleErrors.length) push("consoleErrors", { messages: consoleErrors.slice(0, 5) });
        if (pageErrors.length) push("pageErrors", { messages: pageErrors.slice(0, 5) });

        console.log(`captured ${target.path} @ ${viewport.name} (${theme})`);
        await page.close();
      }

      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

const reportRoot = path.join(root, "reports", "stage15");
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
      axeViolations: report.findings.axeViolations.length,
      consoleErrors: report.findings.consoleErrors.length,
      pageErrors: report.findings.pageErrors.length,
    },
    null,
    2,
  ),
);
console.log(`Wrote reports/stage15/visual-review.json and screenshots to ${outputDirectory}`);
