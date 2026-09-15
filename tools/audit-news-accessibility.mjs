import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium } from "playwright";
import { createStaticServer } from "./static-server.mjs";

/**
 * Stage 13 — axe coverage for the generated news section in both themes.
 *
 * `tests/page-audit.spec.js` runs axe over the sampled public pages in the day
 * theme at desktop width. The news pages are new in Stage 13 and are read on
 * phones in the night theme as much as anywhere else, so this tool re-runs axe
 * over one page of each news type at desktop and mobile widths, day and night,
 * and writes the result to reports/stage13/axe-news.json.
 */
const require = createRequire(import.meta.url);
const axeSource = require("axe-core").source;

const root = process.cwd();
const port = 4188;
const siteRoot = path.join(root, process.env.SITE_ROOT ?? "_site");

const targets = [
  { name: "news landing", path: "/news.html" },
  { name: "2026 article", path: "/news/2026/chucks-memorial-2026/index.html" },
  { name: "2025 article", path: "/news/2025/charlie-mcneil-2025/index.html" },
  { name: "historical article", path: "/news/history/1911-opening-of-bowling-green-and-sale-of/index.html" },
  { name: "2026 archive", path: "/news/2026/index.html" },
  { name: "historical archive", path: "/news/history/index.html" },
  { name: "category page", path: "/news/category/competition/index.html" },
];

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

const server = createStaticServer(siteRoot);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const browser = await chromium.launch();
const results = [];

try {
  for (const target of targets) {
    for (const viewport of viewports) {
      for (const theme of ["day", "night"]) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();

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
        await page.waitForTimeout(200);

        await page.addScriptTag({ content: axeSource }).catch(() => {});
        const violations = await page.evaluate(async () => {
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

        results.push({
          page: target.name,
          path: target.path,
          viewport: viewport.name,
          theme,
          violations,
        });

        if (violations.length > 0) {
          console.log(
            `${target.path} @ ${viewport.name}/${theme}: ${violations
              .map((violation) => `${violation.id}(${violation.nodeCount})`)
              .join(", ")}`,
          );
        }

        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  server.close();
}

const withViolations = results.filter((result) => result.violations.length > 0);
const report = {
  generatedAt: new Date().toISOString(),
  siteRoot,
  checks: results.length,
  pagesWithViolations: withViolations.length,
  violations: withViolations,
  results,
};

const reportRoot = path.join(root, "reports", "stage13");
await mkdir(reportRoot, { recursive: true });
await writeFile(
  path.join(reportRoot, "axe-news.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);

console.log(`\naxe checks: ${results.length}, with violations: ${withViolations.length}`);
