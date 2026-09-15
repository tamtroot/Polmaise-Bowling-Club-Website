import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { SITE_ROOT } from "./helpers/site-root.mjs";

const require = createRequire(import.meta.url);
const axeSource = require("axe-core").source;

/*
 * The release gate: `npm run test:ci`.
 *
 * Deployment is blocked only by what a visitor would notice or what stops the
 * site being published — the build missing pages, a page that does not render,
 * a broken link, navigation or a core interaction that does not work, layout
 * that cannot be used, a new serious accessibility defect, or an artifact that
 * cannot be deployed.
 *
 * Deliberately *not* here (they are optional, and live in the full suite —
 * see README → Test):
 *
 *   - screenshot comparison and platform-specific pixel differences;
 *   - font rasterisation and exact font-swap movement;
 *   - click-stress runs (100 rapid navigations);
 *   - the exhaustive page × theme × viewport matrices and the Stage 2A
 *     structure snapshot;
 *   - visual capture tooling and synthetic visual reports.
 *
 * Those compare a deployable, functioning site with a machine's rendering of
 * it. Their failures do not mean a visitor is affected, so they do not block a
 * release; `npm test` still runs them for anyone who wants the full picture.
 */

/** Representative pages: one per public page type a visitor uses. */
const SMOKE_PAGES = [
  { name: "home", label: "homepage", path: "/index.html" },
  { name: "fixtures", label: "fixtures", path: "/fixtures.html" },
  { name: "news", label: "news", path: "/news.html" },
  {
    name: "news-article-2026",
    label: "news article",
    path: "/news/2026/chucks-memorial-2026/index.html",
  },
  { name: "archive", label: "historical archive", path: "/archive.html" },
  { name: "gallery", label: "gallery", path: "/gallery.html" },
  { name: "membership", label: "membership", path: "/membership.html" },
  { name: "history", label: "history", path: "/history.html" },
  { name: "contact", label: "contact", path: "/contact.html" },
];

/**
 * Accessibility scope: key pages at the two widths the site is designed for,
 * rather than every page × theme × viewport. `serious`/`critical` findings that
 * the full audit already records (pre-existing contrast findings in the footer
 * and the fixtures table) are logged, not re-failed here — a *new* one blocks.
 */
const AXE_COMBOS = [
  { page: "home", width: 1440 },
  { page: "home", width: 375 },
  { page: "fixtures", width: 375 },
  { page: "news-article-2026", width: 1440 },
  { page: "contact", width: 375 },
];

const sitePath = (page) => path.join(SITE_ROOT, decodeURIComponent(page.path.replace(/^\//, "")));
const axeBaselinePath = (name) =>
  path.join(process.cwd(), "reports", "baseline", "page-audit", name, "axe-violations.json");

/** Rule ids the full page audit has already recorded for a page. */
const acceptedAxeRules = async (name) => {
  const baselinePath = axeBaselinePath(name);
  let baseline;
  try {
    baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  } catch (error) {
    throw new Error(
      `cannot read the recorded accessibility findings at ${baselinePath} ` +
        `(${error.code ?? error.message}); run \`npm run test:audit\` to regenerate them`,
    );
  }
  return new Set((baseline.items ?? []).map((entry) => String(entry).split("|")[0].trim()));
};

/** Waits for the page to settle, then scrolls once through it so lazy images load. */
const settleAndScroll = async (page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(200);
};

const brokenImages = (page) =>
  page.evaluate(() =>
    [...document.images]
      .filter((image) => image.getAttribute("src") && image.complete && image.naturalWidth === 0)
      .map((image) => image.currentSrc || image.getAttribute("src")),
  );

test.describe("release gate", () => {
  // The gate runs once, at the desktop width: the tests that need a mobile
  // width set it themselves (375px), so the tablet/mobile projects would only
  // repeat the same checks.
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1280, "The release gate runs on desktop");

  test("the build produced the pages the deployment publishes", async () => {
    expect(
      existsSync(path.join(SITE_ROOT, "index.html")),
      `no built site at ${SITE_ROOT} — run \`npm run build\` before the release gate`,
    ).toBe(true);

    const missing = [];
    for (const page of SMOKE_PAGES) {
      if (!existsSync(sitePath(page))) missing.push(page.path);
    }
    for (const required of ["sitemap.xml", "robots.txt", "styles.css", "script.js"]) {
      if (!existsSync(path.join(SITE_ROOT, required))) missing.push(`/${required}`);
    }
    expect(missing, "the build did not produce these files").toEqual([]);

    // A build that silently drops the generated sections is not deployable, and
    // the artifact must stay an artifact: no source tree, tooling or reports.
    const devDirectories = ["_data", "_includes", "node_modules", "reports", "tests", "tools"];
    const leaked = devDirectories.filter((directory) =>
      existsSync(path.join(SITE_ROOT, directory)),
    );
    expect(leaked, "the build copied development files into the deployed site").toEqual([]);
  });

  test("representative pages render without fatal errors", async ({ page }) => {
    test.setTimeout(120_000);

    for (const smokePage of SMOKE_PAGES) {
      const pageErrors = [];
      const failedAssets = [];
      page.on("pageerror", (error) => pageErrors.push(String(error)));
      page.on("response", (response) => {
        const type = response.request().resourceType();
        if (response.status() >= 400 && ["document", "script", "stylesheet"].includes(type)) {
          failedAssets.push(`${response.status()} ${response.url()}`);
        }
      });

      const response = await page.goto(smokePage.path, { waitUntil: "domcontentloaded" });
      expect(response?.status(), `${smokePage.label}: HTTP status`).toBe(200);
      await expect(
        page.locator("main"),
        `${smokePage.label}: no <main> to render`,
      ).toBeVisible();
      expect(
        (await page.title()).length,
        `${smokePage.label}: empty document title`,
      ).toBeGreaterThan(9);

      await settleAndScroll(page);
      expect(
        await brokenImages(page),
        `${smokePage.label}: images that failed to load`,
      ).toEqual([]);
      expect(pageErrors, `${smokePage.label}: uncaught JavaScript errors`).toEqual([]);
      expect(failedAssets, `${smokePage.label}: missing assets`).toEqual([]);

      page.removeAllListeners("pageerror");
      page.removeAllListeners("response");
    }
  });

  test("navigation works on desktop and in the mobile drawer", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });

    const navLinks = page.locator("header nav ul li a");
    await expect(navLinks, "the inline navigation is missing").toHaveCount(9);
    await expect(navLinks.first()).toBeVisible();

    await page.locator('header nav ul li a[href$="fixtures.html"]').click();
    await expect(page, "a desktop navigation link did not navigate").toHaveURL(/\/fixtures\.html$/);
    await expect(page.locator("main")).toBeVisible();

    // The theme toggle is a core feature: it must switch and switch back.
    const toggle = page.locator("[data-theme-toggle]");
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    const burger = page.locator(".mobile-menu");
    await expect(burger, "the mobile menu button is missing").toBeVisible();
    await burger.click();
    await expect(page.locator("header nav ul"), "the drawer did not open").toHaveClass(/show/);

    await page.locator('header nav ul li a[href$="contact.html"]').click();
    await expect(page, "a drawer link did not navigate").toHaveURL(/\/contact\.html$/);
    await expect(page.locator("main")).toBeVisible();
  });

  test("the layout stays usable at desktop and mobile widths", async ({ page }) => {
    test.setTimeout(120_000);
    const checked = ["/index.html", "/fixtures.html", "/news.html"];

    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      for (const pagePath of checked) {
        await page.goto(pagePath, { waitUntil: "domcontentloaded" });
        await page.evaluate(() => document.fonts.ready);

        const layout = await page.evaluate(() => {
          const box = (selector) => {
            const element = document.querySelector(selector);
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            return {
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height,
            };
          };
          const main = box("main");
          return {
            overflow: document.documentElement.scrollWidth - window.innerWidth,
            main,
            logo: box("body > header .logo"),
            navigation: box("body > header nav") ?? box(".mobile-menu"),
          };
        });

        // Content must be reachable horizontally: a page that overflows hides
        // text and controls off-screen (the accepted design fits every width).
        expect(
          layout.overflow,
          `${pagePath} @ ${width}px: horizontal overflow of ${layout.overflow}px`,
        ).toBeLessThanOrEqual(1);

        expect(layout.main, `${pagePath} @ ${width}px: no <main> box`).not.toBeNull();
        expect(
          layout.main.height,
          `${pagePath} @ ${width}px: <main> has no height`,
        ).toBeGreaterThan(100);
        expect(
          layout.main.left,
          `${pagePath} @ ${width}px: <main> starts outside the viewport`,
        ).toBeGreaterThan(-1);
        expect(
          layout.main.right,
          `${pagePath} @ ${width}px: <main> extends past the viewport`,
        ).toBeLessThanOrEqual(width + 1);

        // Severe header overlap would make navigation unusable.
        if (layout.logo && layout.navigation) {
          const overlaps = !(
            layout.logo.right <= layout.navigation.left + 1 ||
            layout.navigation.right <= layout.logo.left + 1 ||
            layout.logo.bottom <= layout.navigation.top + 1 ||
            layout.navigation.bottom <= layout.logo.top + 1
          );
          expect(overlaps, `${pagePath} @ ${width}px: the header controls overlap`).toBe(false);
        }
      }
    }
  });

  test("key pages have no new serious accessibility findings", async ({ page }) => {
    test.setTimeout(180_000);
    const report = [];

    for (const combo of AXE_COMBOS) {
      const smokePage = SMOKE_PAGES.find((entry) => entry.name === combo.page);
      await page.setViewportSize({
        width: combo.width,
        height: combo.width === 375 ? 812 : 900,
      });
      await page.goto(smokePage.path, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);

      await page.addScriptTag({ content: axeSource });
      const findings = await page.evaluate(async () => {
        const results = await window.axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
        });
        return results.violations
          .filter((violation) => ["serious", "critical"].includes(violation.impact))
          .map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            nodes: violation.nodes.length,
          }));
      });

      const accepted = await acceptedAxeRules(combo.page);
      const blocking = findings.filter((finding) => !accepted.has(finding.id));
      const known = findings.filter((finding) => accepted.has(finding.id));
      if (known.length > 0) {
        report.push(
          `${smokePage.label} @ ${combo.width}px: recorded findings (not blocking): ` +
            known.map((finding) => `${finding.id}(${finding.nodes})`).join(", "),
        );
      }
      expect(
        blocking,
        `${smokePage.label} @ ${combo.width}px: new serious accessibility findings`,
      ).toEqual([]);
    }

    if (report.length > 0) {
      console.log(`[ci-gate] ${report.join("\n[ci-gate] ")}`);
    }
  });

  test("structure, metadata and the sitemap are present", async ({ page, request }) => {
    test.setTimeout(120_000);

    for (const smokePage of SMOKE_PAGES) {
      await page.goto(smokePage.path, { waitUntil: "domcontentloaded" });
      const structure = await page.evaluate(() => ({
        mains: document.querySelectorAll("main").length,
        headings: document.querySelectorAll("h1").length,
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.getAttribute("content"),
        canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
        lang: document.documentElement.getAttribute("lang"),
      }));

      expect(structure.mains, `${smokePage.label}: <main> elements`).toBe(1);
      expect(structure.headings, `${smokePage.label}: <h1> elements`).toBe(1);
      expect(structure.title.length, `${smokePage.label}: title`).toBeGreaterThan(9);
      expect(
        structure.description?.length ?? 0,
        `${smokePage.label}: meta description`,
      ).toBeGreaterThan(49);
      expect(structure.canonical, `${smokePage.label}: canonical URL`).toMatch(/^https?:\/\//);
      expect(structure.lang, `${smokePage.label}: lang attribute`).toMatch(/^en/i);
    }

    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status(), "sitemap.xml").toBe(200);
    const locations = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => match[1],
    );
    expect(locations.length, "sitemap entries").toBeGreaterThan(20);
    expect(locations.some((url) => url.endsWith("/index.html") || url.endsWith("/"))).toBe(true);
    expect((await request.get("/robots.txt")).status(), "robots.txt").toBe(200);
  });
});
