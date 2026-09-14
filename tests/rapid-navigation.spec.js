import { expect, test } from "@playwright/test";
import { freezeBaselineClock } from "./helpers/baseline-clock.mjs";

/**
 * Stage 10: rapid-navigation stress test.
 *
 * Clicking through the site quickly must never leave a page unresponsive. Each
 * hop is started without waiting for the previous page to finish loading, then
 * the page has to prove it is alive: the document must reach DOMContentLoaded,
 * the theme control must react to a real click, and the document must scroll.
 */
const ROUTE = [
  { link: "About Us", path: "/about.html" },
  { link: "Membership", path: "/membership.html" },
  { link: "Fixtures", path: "/fixtures.html" },
  { link: "News & Events", path: "/news.html" },
  { link: "Gallery", path: "/gallery.html" },
  { link: "Contact Us", path: "/contact.html" },
  { link: "Sponsors", path: "/sponsors.html" },
  { link: "Honours", path: "/honours.html" },
  { link: "Home", path: "/index.html" },
];

const DOM_CONTENT_LOADED_BUDGET_MS = 8_000;
const INTERACTION_BUDGET_MS = 1_500;

test.describe("rapid navigation", () => {
  test("clicking quickly through the whole site never freezes a page", async ({
    page,
  }) => {
    const pageErrors = [];
    const navigationTimings = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await freezeBaselineClock(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });

    for (let round = 0; round < 2; round += 1) {
      for (const hop of ROUTE) {
        const startedAt = Date.now();
        const navigation = page.waitForNavigation({ waitUntil: "commit" }).catch(() => null);
        // A real user click. Under 1280px the links live in the burger drawer,
        // so open it first exactly as a user would.
        const burger = page.locator(".mobile-menu");
        if (await burger.isVisible().catch(() => false)) {
          await burger.click({ noWaitAfter: true, timeout: 3_000 }).catch(() => {});
          // The drawer animates open; wait for the link to be clickable before
          // clicking it so the test measures the site, not the test's timing.
          await page
            .locator("nav ul.show")
            .waitFor({ state: "visible", timeout: 2_000 })
            .catch(() => {});
        }
        await page
          .locator(
            `.mobile-nav-dropdown a:has-text("${hop.link}"), nav ul a:has-text("${hop.link}")`,
          )
          .first()
          .click({ noWaitAfter: true, timeout: 3_000 })
          .catch(async () => {
            // Falling back to a direct navigation is legitimate (e.g. a link
            // covered by an overlay); only report it if the page is then dead.
            await page.goto(hop.path, { waitUntil: "commit" });
          });
        await navigation;

        // 1. The document must become interactive inside the budget.
        const interactive = await page
          .waitForFunction(() => document.readyState !== "loading", null, {
            timeout: DOM_CONTENT_LOADED_BUDGET_MS,
          })
          .then(() => true)
          .catch(() => false);

        // 2. A real interaction must be handled promptly.
        const toggle = page.locator("[data-theme-toggle]");
        const themeBefore = await page.evaluate(() =>
          document.documentElement.getAttribute("data-theme"),
        );
        const interactionStart = Date.now();
        const responded = await toggle
          .click({ timeout: INTERACTION_BUDGET_MS })
          .then(() => true)
          .catch(() => false);
        const themeAfter = responded
          ? await page
              .waitForFunction(
                (before) => document.documentElement.getAttribute("data-theme") !== before,
                themeBefore,
                { timeout: INTERACTION_BUDGET_MS },
              )
              .then(() => true)
              .catch(() => false)
          : false;
        const interactionMs = Date.now() - interactionStart;

        // 3. The document must still scroll.
        const scrolled = await page.evaluate(async () => {
          window.scrollTo(0, 400);
          await new Promise((resolve) => requestAnimationFrame(() => resolve()));
          return window.scrollY;
        });

        navigationTimings.push({
          round,
          to: hop.path,
          totalMs: Date.now() - startedAt,
          interactionMs,
          interactive,
          themeAfter,
          scrolled,
        });

        expect(
          { interactive, themeAfter, scrolled: scrolled > 0 },
          `Page became unresponsive after navigating to ${hop.path} (round ${round})`,
        ).toEqual({ interactive: true, themeAfter: true, scrolled: true });
      }
    }

    expect(pageErrors).toEqual([]);
    console.log(
      `rapid navigation: ${navigationTimings.length} hops, slowest ${Math.max(
        ...navigationTimings.map((timing) => timing.totalMs),
      )}ms, slowest interaction ${Math.max(
        ...navigationTimings.map((timing) => timing.interactionMs),
      )}ms`,
    );
  });

  test("quick hops with the mobile menu do not leave the drawer stuck open", async ({
    page,
  }) => {
    await freezeBaselineClock(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });

    for (const hop of ROUTE.slice(0, 5)) {
      const navigation = page.waitForNavigation({ waitUntil: "commit" }).catch(() => null);
      if (await page.locator(".mobile-menu").isVisible()) {
        await page.locator(".mobile-menu").click({ noWaitAfter: true }).catch(() => {});
        await page
          .locator(`.mobile-nav-dropdown a:has-text("${hop.link}"), nav ul a:has-text("${hop.link}")`)
          .first()
          .click({ noWaitAfter: true, timeout: 5_000 })
          .catch(async () => {
            await page.goto(hop.path, { waitUntil: "commit" });
          });
      } else {
        await page.goto(hop.path, { waitUntil: "commit" });
      }
      await navigation;
      await page.waitForFunction(() => document.readyState !== "loading", null, {
        timeout: DOM_CONTENT_LOADED_BUDGET_MS,
      });

      const state = await page.evaluate(() => ({
        menuOpen: document.body.classList.contains("menu-open"),
        drawerOpen: Boolean(document.querySelector("nav ul.show")),
        overflow: getComputedStyle(document.body).overflow,
      }));
      expect(state, `Navigation drawer state after arriving at ${hop.path}`).toEqual({
        menuOpen: false,
        drawerOpen: false,
        overflow: "visible",
      });
    }
  });

  test("returning to a page through history never restores a locked scroll state", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === "desktop", "The drawer only exists below 1280px");
    await freezeBaselineClock(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });

    // Open the drawer (body gets overflow: hidden) and then leave the page.
    await page.locator(".mobile-menu").click();
    await expect(page.locator("nav ul")).toHaveClass(/show/);

    const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded" });
    await page.locator('nav ul a:has-text("About Us")').click({ noWaitAfter: true });
    await navigation;

    // Back via history: the restored document must not be scroll-locked.
    await page.goBack({ waitUntil: "domcontentloaded" });
    const state = await page.evaluate(() => ({
      menuOpen: document.body.classList.contains("menu-open"),
      drawerOpen: Boolean(document.querySelector("nav ul.show")),
      overflow: getComputedStyle(document.body).overflow,
    }));
    expect(state).toEqual({ menuOpen: false, drawerOpen: false, overflow: "visible" });

    await page.evaluate(() => window.scrollTo(0, 500));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });
});
