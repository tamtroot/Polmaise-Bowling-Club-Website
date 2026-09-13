import { expect, test } from "@playwright/test";

test.describe("JavaScript interactions", () => {
  test("mobile navigation opens and closes", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile navigation test");

    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.locator(".mobile-menu").click();
    await expect(page.locator("nav ul")).toHaveClass(/show/);

    await page.locator("body").click({ position: { x: 380, y: 10 } });
    await expect(page.locator("nav ul")).not.toHaveClass(/show/);
  });

  test("desktop navigation remains visible", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Desktop navigation test");

    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("nav ul")).toBeVisible();
  });

  test("accordions toggle one panel at a time", async ({ page }) => {
    await page.goto("/membership.html", { waitUntil: "domcontentloaded" });
    const headers = page.locator(".accordion-header");

    await headers.nth(0).click();
    await expect(page.locator(".accordion-item").nth(0)).toHaveClass(/active/);

    await headers.nth(1).click();
    await expect(page.locator(".accordion-item").nth(0)).not.toHaveClass(/active/);
    await expect(page.locator(".accordion-item").nth(1)).toHaveClass(/active/);
  });

  test("fixtures apply date state after initialisation", async ({ page }) => {
    await page.goto("/fixtures.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".fixtures-table tbody tr")).not.toHaveCount(0);
    await expect(page.locator(".fixtures-table tbody tr.past-fixture")).not.toHaveCount(0);
  });

  test("gallery albums open and return to the album grid", async ({ page }) => {
    await page.goto("/gallery.html", { waitUntil: "domcontentloaded" });

    const albumId = "finals-day-2026";
    await page.locator(`.album-card[data-album="${albumId}"]`).first().click();
    await expect(page.locator(`#${albumId}`)).toHaveClass(/active/);
    await expect(page.locator("#album7 .gallery-item")).not.toHaveCount(0);

    await page.locator(`#${albumId} .close-album`).first().click();
    await expect(page.locator(`#${albumId}`)).not.toHaveClass(/active/);
    await expect(page.locator(".album-cards").first()).toBeVisible();
  });

  test("custom lightbox opens and closes with Escape", async ({ page }) => {
    await page.goto("/about.html", { waitUntil: "domcontentloaded" });
    await page.locator(".lightbox-image").first().click();

    await expect(page.locator("#imageLightbox")).toBeVisible();
    await expect(page.locator("#lightboxImage")).toHaveAttribute("src", /.+/);

    await page.locator("#imageLightbox .lightbox-close").click();
    await expect(page.locator("#imageLightbox")).toBeHidden();
  });

  test("news cards and custom lightbox remain interactive", async ({ page }) => {
    await page.goto("/news.html", { waitUntil: "domcontentloaded" });
    await page.locator(".news-card").first().click();

    const activeArticle = page.locator(".news-item.active").first();
    await expect(activeArticle).toBeVisible();
    await activeArticle.locator(".zoomable-image").first().click();
    await expect(page.locator("#imageLightbox")).toBeVisible();

    await page.locator("#imageLightbox .lightbox-close").click();
    await expect(page.locator("#imageLightbox")).toBeHidden();
  });

  test("archive uses Lightbox2 for gallery images", async ({ page }) => {
    await page.goto("/archive.html", { waitUntil: "domcontentloaded" });
    await page.locator("[data-lightbox]").first().click();
    await expect(page.locator(".lightbox")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("news history archive and article toggles work", async ({ page }) => {
    await page.goto("/news.html", { waitUntil: "domcontentloaded" });

    await page.locator("[data-history-archive-toggle]").click();
    await expect(page.locator("#history-archive-content")).toBeVisible();

    await page.locator("#history-grid [data-history-article]").first().click();
    await expect(page.locator("#history-grid")).toBeHidden();
    await expect(page.locator(".history-item.active")).toBeVisible();

    await page.locator(".history-item.active [data-history-close]").click();
    await expect(page.locator("#history-grid")).toBeVisible();
  });

  test("PhotoAlbum images are generated dynamically", async ({ page }) => {
    await page.goto("/PhotoAlbums/top-15-final-2025.html", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("#top15-gallery .album-item")).not.toHaveCount(0);
  });

  test("signup validation and member number field work", async ({ page }) => {
    await page.goto("/signup.html", { waitUntil: "domcontentloaded" });

    await page.locator("#membershipStatus").check();
    await expect(page.locator("#memberNumberField")).toBeVisible();

    await page.locator("#signupForm").evaluate((form) => {
      form.noValidate = true;
    });
    await page.locator('#signupForm button[type="submit"]').click();
    await expect(page.locator("#signupForm .error-message")).not.toHaveCount(0);
  });

  test("live scoring controls expand and exit", async ({ page }) => {
    await page.goto("/live-scoring.html", { waitUntil: "domcontentloaded" });

    await page.locator("#expandScoreboardBtn").click();
    await expect(page.locator("body")).toHaveClass(/scoreboard-expanded/);
    await expect(page.locator("#expandScoreboardBtn")).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("Escape");
    await expect(page.locator("body")).not.toHaveClass(/scoreboard-expanded/);
  });

  test("article mobile dropdown remains interactive", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Article mobile navigation test");

    await page.goto("/News%20articles/presentation-dance-2025.html", {
      waitUntil: "domcontentloaded",
    });
    await page.locator(".mobile-menu").click();
    await expect(page.locator("#mobileNavDropdown")).toHaveClass(/show/);
  });
});
