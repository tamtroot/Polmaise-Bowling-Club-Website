import { expect, test } from "@playwright/test";
import { freezeBaselineClock } from "./helpers/baseline-clock.mjs";
import { SITE_PAGES } from "./helpers/site-pages.mjs";

test.describe("visual regression baseline", () => {
  for (const sitePage of SITE_PAGES) {
    test(`${sitePage.label} matches the visual baseline`, async ({ page }) => {
      await freezeBaselineClock(page);
      await page.goto(sitePage.path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);

      await expect(page).toHaveScreenshot(`${sitePage.name}.png`, {
        mask: [page.locator("iframe")],
      });
    });

    // Stage 9 introduced the night theme, so the desktop night rendering is
    // part of the visual contract as well.
    test(`${sitePage.label} matches the night-theme baseline`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "Night baselines are captured on desktop");
      await page.addInitScript(() => {
        try {
          window.localStorage.setItem("polmaise-theme", "dark");
        } catch (error) {
          /* storage unavailable */
        }
      });
      await freezeBaselineClock(page);
      await page.goto(sitePage.path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);

      await expect(page).toHaveScreenshot(`${sitePage.name}-night.png`, {
        mask: [page.locator("iframe")],
      });
    });
  }
});
