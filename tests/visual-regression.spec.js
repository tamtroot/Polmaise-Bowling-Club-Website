import { expect, test } from "@playwright/test";
import { SITE_PAGES } from "./helpers/site-pages.mjs";

test.describe("visual regression baseline", () => {
  for (const sitePage of SITE_PAGES) {
    test(`${sitePage.label} matches the visual baseline`, async ({ page }) => {
      await page.goto(sitePage.path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);

      await expect(page).toHaveScreenshot(`${sitePage.name}.png`, {
        mask: [page.locator("iframe")],
      });
    });
  }
});
