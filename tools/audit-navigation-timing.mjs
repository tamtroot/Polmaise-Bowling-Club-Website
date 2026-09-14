import path from "node:path";
import { chromium } from "playwright";
import { SITE_PAGES } from "../tests/helpers/site-pages.mjs";
import { createStaticServer } from "./static-server.mjs";

/**
 * Stage 10: where does a page's time actually go?
 *
 * Walks the site the way a user does (desktop nav, or burger menu on mobile)
 * and records, per hop: navigation timings, cross-origin resource timings,
 * long tasks and whether the page's own JavaScript became interactive.
 */
const root = process.cwd();
const siteRoot = path.resolve(root, process.env.SITE_ROOT ?? "_site");
const port = 4189;
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];
const route = SITE_PAGES.slice(0, 9).map((page) => page.path);

const server = createStaticServer(siteRoot);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const browser = await chromium.launch();
const report = [];

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    // No frozen clock here: this tool reads paint/resource timings, which the
    // fake clock suppresses.

    const externalRequests = new Map();
    page.on("requestfinished", async (request) => {
      const url = request.url();
      if (url.startsWith(`http://127.0.0.1:${port}`)) return;
      const response = await request.response().catch(() => null);
      externalRequests.set(url, {
        url,
        status: response ? response.status() : null,
      });
    });
    page.on("requestfailed", (request) => {
      if (request.url().startsWith(`http://127.0.0.1:${port}`)) return;
      externalRequests.set(request.url(), {
        url: request.url(),
        status: "FAILED",
        failure: request.failure()?.errorText,
      });
    });

    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded" });

    for (const routePath of [...route, "/index.html"]) {
      const startedAt = Date.now();
      const isMobile = viewport.name === "mobile";
      const navigation = page.waitForNavigation({ waitUntil: "commit" }).catch(() => null);

      const target = SITE_PAGES.find((sitePage) => sitePage.path === routePath);
      const label = target?.label ?? routePath;
      if (isMobile) {
        await page.locator(".mobile-menu").click({ noWaitAfter: true }).catch(() => {});
        await page
          .locator(`.mobile-nav-dropdown a:has-text("${label}"), nav ul a:has-text("${label}")`)
          .first()
          .click({ noWaitAfter: true, timeout: 3_000 })
          .catch(async () => {
            await page.goto(`http://127.0.0.1:${port}${routePath}`, { waitUntil: "commit" });
          });
      } else {
        await page
          .locator(`header nav a:has-text("${label}")`)
          .first()
          .click({ noWaitAfter: true, timeout: 3_000 })
          .catch(async () => {
            await page.goto(`http://127.0.0.1:${port}${routePath}`, { waitUntil: "commit" });
          });
      }
      await navigation;
      // Sample after the document is parsed so the paint and resource timings
      // are populated (the point of this tool is to see where time went).
      await page
        .waitForLoadState("domcontentloaded", { timeout: 10_000 })
        .catch(() => {});

      const timing = await page
        .evaluate(() => {
          const nav = performance.getEntriesByType("navigation")[0];
          const paints = Object.fromEntries(
            performance.getEntriesByType("paint").map((entry) => [entry.name, Math.round(entry.startTime)]),
          );
          const external = performance
            .getEntriesByType("resource")
            .filter((entry) => !entry.name.startsWith(location.origin))
            .map((entry) => ({
              name: entry.name.replace(/^https?:\/\//, "").slice(0, 60),
              duration: Math.round(entry.duration),
              start: Math.round(entry.startTime),
              size: entry.transferSize,
            }))
            .sort((left, right) => right.duration - left.duration);
          return {
            readyState: document.readyState,
            domInteractive: nav ? Math.round(nav.domInteractive) : null,
            domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
            loadEvent: nav ? Math.round(nav.loadEventEnd) : null,
            firstPaint: paints["first-paint"] ?? null,
            firstContentfulPaint: paints["first-contentful-paint"] ?? null,
            externalCount: external.length,
            slowestExternal: external.slice(0, 4),
          };
        })
        .catch((error) => ({ error: error.message }));

      // Responsiveness: does the page's own JS respond to a click?
      const interactionStart = Date.now();
      const responsive = await page
        .locator("[data-theme-toggle]")
        .click({ timeout: 2_000 })
        .then(() => true)
        .catch(() => false);
      const interactionMs = Date.now() - interactionStart;

      report.push({
        viewport: viewport.name,
        path: routePath,
        hopMs: Date.now() - startedAt,
        interactionMs,
        responsive,
        ...timing,
      });
      console.log(
        `${viewport.name} ${routePath}: hop ${Date.now() - startedAt}ms, DCL ${timing.domContentLoaded ?? "?"}ms, FCP ${timing.firstContentfulPaint ?? "?"}ms, slowest external ${timing.slowestExternal?.[0]?.name ?? "none"} ${timing.slowestExternal?.[0]?.duration ?? 0}ms`,
      );
    }

    console.log("\nExternal requests observed:");
    for (const entry of [...externalRequests.values()]) {
      console.log(`  ${String(entry.status).padEnd(6)} ${entry.url}`);
    }
    console.log("");
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}

const slowest = [...report].sort((left, right) => (right.domContentLoaded ?? 0) - (left.domContentLoaded ?? 0)).slice(0, 5);
console.log("\nSlowest DOMContentLoaded hops:");
for (const entry of slowest) {
  console.log(`  ${entry.viewport} ${entry.path}: DCL ${entry.domContentLoaded}ms, FCP ${entry.firstContentfulPaint}ms`);
}
