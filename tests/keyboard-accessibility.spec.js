import { expect, test } from "@playwright/test";
import { freezeBaselineClock } from "./helpers/baseline-clock.mjs";

// Keyboard operation of the interactive controls that were click-only before
// Stage 7. Each test drives the control with the keyboard rather than a click.
test.describe("keyboard accessibility", () => {
  test("mobile navigation button exposes state and opens with the keyboard", async ({ page }) => {
    await freezeBaselineClock(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });

    const button = page.locator(".mobile-menu");
    await expect(button).toHaveAttribute("aria-controls", "primary-menu");
    await expect(button).toHaveAttribute("aria-expanded", "false");

    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#primary-menu")).toHaveClass(/show/);

    await page.keyboard.press(" ");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#primary-menu")).not.toHaveClass(/show/);
  });

  test("accordion headers are buttons that toggle with the keyboard", async ({ page }) => {
    await freezeBaselineClock(page);
    await page.goto("/membership.html", { waitUntil: "domcontentloaded" });

    const header = page.locator(".accordion-header").first();
    await expect(header).toHaveJSProperty("tagName", "BUTTON");
    await expect(header).toHaveAttribute("aria-expanded", "false");

    await header.focus();
    await page.keyboard.press("Enter");
    await expect(header).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".accordion-item").first()).toHaveClass(/active/);

    const second = page.locator(".accordion-header").nth(1);
    await second.focus();
    await page.keyboard.press("Enter");
    await expect(second).toHaveAttribute("aria-expanded", "true");
    await expect(header).toHaveAttribute("aria-expanded", "false");
  });

  test("gallery album cards open with the keyboard", async ({ page }) => {
    await freezeBaselineClock(page);
    await page.goto("/gallery.html", { waitUntil: "domcontentloaded" });

    const card = page.locator('[data-album-open="finals-day-2026"]');
    await expect(card).toHaveAttribute("role", "button");
    await expect(card).toHaveAttribute("tabindex", "0");

    await card.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#finals-day-2026")).toHaveClass(/active/);
  });

  test("gallery album link cards are real links", async ({ page }) => {
    await freezeBaselineClock(page);
    await page.goto("/gallery.html", { waitUntil: "domcontentloaded" });

    const link = page.locator('a.album-card[href="PhotoAlbums/presentation-dance-2025.html"]');
    await expect(link).toHaveCount(1);
  });

  test("news cards open their article page with the keyboard", async ({ page }) => {
    await freezeBaselineClock(page);
    await page.goto("/news.html", { waitUntil: "domcontentloaded" });

    // Stage 13 cards are real links, so Enter follows them like any other link.
    const card = page.locator(".news-grid .news-card-title a").first();
    await expect(card).toHaveAttribute("href", /.+/);

    await card.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/news\//);
    await expect(page.locator(".article-header h2")).toBeVisible();
  });

  test("timeline entries on the about page open with the keyboard", async ({ page }) => {
    await freezeBaselineClock(page);
    await page.goto("/about.html", { waitUntil: "domcontentloaded" });

    const entry = page.locator('[data-history-article="1911-founding"]');
    await expect(entry).toHaveAttribute("tabindex", "0");

    await entry.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".article-viewer")).toHaveClass(/active/);
  });

  test("signup validation reports errors to assistive technology", async ({ page }) => {
    await freezeBaselineClock(page);
    await page.goto("/signup.html", { waitUntil: "domcontentloaded" });

    const submit = page.locator('#signupForm button[type="submit"]');
    // Skip native validation so the page's own validation runs.
    await page.locator("#signupForm").evaluate((form) => {
      form.noValidate = true;
    });
    await submit.focus();
    await page.keyboard.press("Enter");

    const firstName = page.locator("#firstName");
    await expect(firstName).toHaveAttribute("aria-invalid", "true");
    await expect(firstName).toHaveAttribute("aria-describedby", "firstName-error");
    await expect(page.locator("#firstName-error")).toHaveAttribute("role", "alert");

    // The password hint stays associated even when an error is present.
    await expect(page.locator("#password")).toHaveAttribute("aria-describedby", /password-hint/);
  });

  test("keyboard focus produces a visible indicator", async ({ page }) => {
    await freezeBaselineClock(page);
    await page.goto("/about.html", { waitUntil: "domcontentloaded" });

    await page.keyboard.press("Tab");
    const indicator = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element) {
        return null;
      }
      const style = getComputedStyle(element);
      return {
        tag: element.tagName.toLowerCase(),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });

    expect(indicator).not.toBeNull();
    expect(indicator.outlineStyle).not.toBe("none");
    expect(Number.parseFloat(indicator.outlineWidth)).toBeGreaterThan(0);
  });

  test("reduced motion preferences are respected", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await freezeBaselineClock(page);
    await page.goto("/membership.html", { waitUntil: "domcontentloaded" });

    const transition = await page.evaluate(() => {
      const element = document.querySelector(".accordion-content");
      return getComputedStyle(element).transitionDuration;
    });

    // The reduced-motion rule collapses transition durations.
    expect(transition.split(",").every((value) => Number.parseFloat(value) <= 0.01)).toBe(true);
  });
});
