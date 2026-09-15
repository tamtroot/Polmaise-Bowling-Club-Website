import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium } from "playwright";
import { createStaticServer } from "./static-server.mjs";

const require = createRequire(import.meta.url);
const axeSource = require("axe-core").source;

/**
 * Stage 14 visual review capture for the fixtures page.
 *
 * The fixtures page now opens on the current point of the season and keeps the
 * earlier completed fixtures behind a control, so the review needs both states
 * at every width and in both themes — plus the checks that are hard to eyeball
 * (horizontal overflow, broken images, console errors, how many fixtures are
 * visible collapsed versus expanded).
 *
 * PNGs are written outside the repository (OUTPUT_DIR); the JSON findings go to
 * reports/stage14/visual-review.json. Run it against a pinned-date build to
 * review another point in the season:
 *
 *   SITE_ROOT=_site-fixtures-midseason LABEL=mid-season node tools/capture-stage14-visuals.mjs
 */
const root = process.cwd();
const siteRoot = path.resolve(root, process.env.SITE_ROOT ?? "_site");
const label = process.env.LABEL ?? "current";
const outputDirectory = path.resolve(
  process.env.OUTPUT_DIR ??
    path.join(process.env.TEMP ?? process.env.TMP ?? root, "polmaise-stage14-visuals", label),
);
const port = 4189;

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
  label,
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
    const table = document.querySelector(".fixtures-table");
    const cards = document.querySelector(".fixtures-table-mobile");
    const visible = (element) => {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const tableRows = table ? [...table.querySelectorAll("tbody tr")] : [];
    const cardItems = cards ? [...cards.querySelectorAll(".fixture-card")] : [];

    return {
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      brokenImages: [...document.images]
        .filter((image) => image.complete && image.naturalWidth === 0 && image.getBoundingClientRect().width > 0)
        .map((image) => image.getAttribute("src")),
      tableRows: tableRows.length,
      visibleTableRows: tableRows.filter(visible).length,
      cards: cardItems.length,
      visibleCards: cardItems.filter(visible).length,
      toggleState: [...document.querySelectorAll("[data-fixtures-toggle]")].map((toggle) => ({
        visible: visible(toggle),
        expanded: toggle.getAttribute("aria-expanded"),
        label: toggle.textContent.trim().replace(/\s+/g, " "),
      })),
      nextFixtureMarked: document.querySelectorAll(".next-fixture").length,
      nextFixtureVisibleInTable: (() => {
        const marker = table?.querySelector(".next-fixture");
        return marker ? visible(marker) : null;
      })(),
      nextFixtureVisibleInCards: (() => {
        const marker = cards?.querySelector(".next-fixture");
        return marker ? visible(marker) : null;
      })(),
      scrollHeight: document.documentElement.scrollHeight,
    };
  });

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    });

    for (const theme of ["day", "night"]) {
      for (const state of ["collapsed", "expanded"]) {
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
        await page.goto(`http://127.0.0.1:${port}/fixtures.html`, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
        await page.evaluate(() => document.fonts.ready);

        if (state === "expanded") {
          // The visible control differs per layout; click whichever one shows.
          const toggle = page.locator("[data-fixtures-toggle]:visible").first();
          await toggle.click();
        }

        await page.waitForTimeout(250);
        const diagnostics = await probe(page);

        await page.addScriptTag({ content: axeSource }).catch(() => {});
        const axeViolations = await page.evaluate(async () => {
          const report = await window.axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
          });
          return report.violations.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            nodeCount: violation.nodes.length,
            targets: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
          }));
        });

        const directory = path.join(outputDirectory, theme);
        await mkdir(directory, { recursive: true });
        const file = path.join(directory, `fixtures-${state}-${viewport.name}.png`);
        await page.screenshot({ path: file, fullPage: true });

        report.captures.push({
          viewport: viewport.name,
          theme,
          state,
          file: path.relative(root, file).split(path.sep).join("/"),
          ...diagnostics,
          axeViolations,
          consoleErrors,
          pageErrors,
        });

        if (diagnostics.horizontalOverflow > 1) {
          report.findings.horizontalOverflow.push({
            viewport: viewport.name,
            theme,
            state,
            overflow: Math.round(diagnostics.horizontalOverflow),
          });
        }
        if (diagnostics.brokenImages.length) {
          report.findings.brokenImages.push({
            viewport: viewport.name,
            theme,
            state,
            images: diagnostics.brokenImages.slice(0, 5),
          });
        }
        if (axeViolations.length) {
          report.findings.axeViolations.push({
            viewport: viewport.name,
            theme,
            state,
            violations: axeViolations,
          });
        }
        if (consoleErrors.length) {
          report.findings.consoleErrors.push({
            viewport: viewport.name,
            theme,
            state,
            messages: consoleErrors.slice(0, 5),
          });
        }
        if (pageErrors.length) {
          report.findings.pageErrors.push({
            viewport: viewport.name,
            theme,
            state,
            messages: pageErrors.slice(0, 5),
          });
        }

        console.log(`captured fixtures @ ${viewport.name} (${theme}, ${state})`);
        await page.close();
      }
    }

    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}

const reportRoot = path.join(root, "reports", "stage14");
await mkdir(reportRoot, { recursive: true });
await writeFile(
  path.join(reportRoot, `visual-review-${label}.json`),
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
console.log(`Wrote reports/stage14/visual-review-${label}.json and screenshots to ${outputDirectory}`);
