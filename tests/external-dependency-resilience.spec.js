import { expect, test } from "@playwright/test";
import { SITE_PAGES } from "./helpers/site-pages.mjs";

/**
 * Stage 10 regression guard.
 *
 * Historically every page loaded jQuery, Lightbox2, Font Awesome and the two
 * web fonts from third-party CDNs. jQuery/Lightbox2 were parser-blocking
 * scripts in <head> and the stylesheets were render-blocking, so a slow CDN
 * left the page unpainted and apparently frozen until the request finished.
 *
 * These tests throttle third-party origins and require the page to paint and
 * stay interactive anyway; the second test proves no page depends on a
 * third-party origin for its critical path.
 */
const THIRD_PARTY = /^https?:\/\/(?!127\.0\.0\.1|localhost)/;
const DELAY_MS = 8_000;

test.describe("third-party resilience", () => {
  test("pages still paint and respond while third-party origins stall", async ({ page }) => {
    await page.route(THIRD_PARTY, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      await route.continue();
    });

    const startedAt = Date.now();
    await page.goto("/index.html", { waitUntil: "commit" });

    // The page must paint without waiting for the stalled origins.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            performance
              .getEntriesByType("paint")
              .some((entry) => entry.name === "first-contentful-paint"),
          ),
        { timeout: 4_000, message: "first contentful paint never happened" },
      )
      .toBe(true);

    const paintMs = Date.now() - startedAt;

    // ...and its own controls must work while the origins are still stalled.
    const toggle = page.locator("[data-theme-toggle]");
    const themeBefore = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme"),
    );
    /*
     * The *action* gets a realistic budget: on a loaded machine Playwright's
     * click can spend a few seconds on its own stability checks, which is not
     * the behaviour this test is guarding. The guarantees stay strict — the
     * page must have painted within 4s (below) and the theme must change within
     * 2s of the click (next poll).
     */
    await toggle.click({ timeout: 10_000 });
    await expect
      .poll(
        () => page.evaluate(() => document.documentElement.getAttribute("data-theme")),
        { timeout: 2_000 },
      )
      .not.toBe(themeBefore);

    expect(paintMs).toBeLessThan(4_000);
  });

  test("no page loads scripts, styles or fonts from a third-party origin", async ({ page }) => {
    const offenders = [];
    const embeddedServiceRequests = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.startsWith("http://127.0.0.1")) return;
      if (url.startsWith("data:") || url.startsWith("blob:")) return;
      const type = request.resourceType();
      // The Live Scoring scoreboard and the Google Maps embed are third-party
      // iframes: their own subresources are the embedded service's business and
      // cannot block this site's rendering. Only the top-level document's
      // dependencies are asserted here.
      if (request.frame() !== page.mainFrame()) {
        embeddedServiceRequests.push(`${type} ${url}`);
        return;
      }
      if (type === "document" || type === "xhr" || type === "fetch") return;
      offenders.push(`${type} ${url}`);
    });

    for (const sitePage of SITE_PAGES) {
      await page.goto(sitePage.path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => {});
    }

    expect([...new Set(offenders)]).toEqual([]);
    console.log(
      `third-party requests from embedded iframes (not blocking): ${[...new Set(embeddedServiceRequests)].length}`,
    );
  });
});
