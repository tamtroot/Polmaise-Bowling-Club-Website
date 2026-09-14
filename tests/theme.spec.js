import { expect, test } from "@playwright/test";
import { freezeBaselineClock } from "./helpers/baseline-clock.mjs";

test.describe("day/night theme", () => {
  test("defaults to the day theme without stored preference", async ({ page }) => {
    await freezeBaselineClock(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator("[data-theme-toggle]")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("[data-theme-toggle]")).toHaveAttribute(
      "aria-label",
      "Switch to night theme",
    );
  });

  test("switches to the night theme and back", async ({ page }) => {
    await freezeBaselineClock(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });

    const toggle = page.locator("[data-theme-toggle]");
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toHaveAttribute("aria-label", "Switch to day theme");

    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  test("persists the choice across reloads and pages", async ({ page }) => {
    await freezeBaselineClock(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.locator("[data-theme-toggle]").click();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.goto("/gallery.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("[data-theme-toggle]")).toHaveAttribute("aria-pressed", "true");
  });

  test.describe("with a stored day preference", () => {
    test.use({ storageState: undefined });

    test("an explicit day choice is not overridden by the system preference", async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.addInitScript(() => {
        window.localStorage.setItem("polmaise-theme", "light");
      });
      await freezeBaselineClock(page);
      await page.goto("/index.html", { waitUntil: "domcontentloaded" });

      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    });
  });

  test("the toggle is keyboard operable and keeps a visible focus ring", async ({ page }) => {
    await freezeBaselineClock(page);
    await page.goto("/about.html", { waitUntil: "domcontentloaded" });

    const toggle = page.locator("[data-theme-toggle]");
    await toggle.focus();
    const outline = await toggle.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
    });
    expect(outline.style).not.toBe("none");
    expect(outline.width).toBeGreaterThan(0);

    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.keyboard.press(" ");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("night theme produces no console errors and keeps content visible", async ({ page }) => {
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });

    await freezeBaselineClock(page);
    await page.goto("/fixtures.html", { waitUntil: "domcontentloaded" });
    await page.locator("[data-theme-toggle]").click();
    await page.waitForTimeout(300);

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    // Fixtures use a desktop table and a compact card layout; pin the viewport
    // so the assertion is explicit rather than dependent on the project size.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator(".fixtures-table")).toBeVisible();
    await expect(page.locator(".fixtures-table tbody tr").first()).toBeVisible();
    // The mobile card layout is shown at small viewports only.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".fixture-card").first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});
