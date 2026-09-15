import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import newsArchive from "../_data/newsArchive.js";
import { writeMeasurement } from "./helpers/baseline.mjs";
import { SITE_ROOT } from "./helpers/site-root.mjs";

/**
 * Stage 15 — the historical archive index at /news/history/.
 *
 * The archive is generated from the Stage 13 historical collection, so the
 * expectations here are derived from that data rather than typed in: the item
 * count, the year chapters, the order, the images and the excerpts all have to
 * match `_data/newsArchive.js` (which in turn reads the article files).
 */
const ARCHIVE_PATH = "/news/history/index.html";
const history = newsArchive.history;
const historyYears = newsArchive.historyYears;

/** Current-news titles, used to prove nothing leaks into the archive. */
const currentTitles = newsArchive.articles.map((article) => article.title);

test.describe("historical archive index", () => {
  test("shows every historical item exactly once", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Archive checks run once");

    await page.goto(ARCHIVE_PATH, { waitUntil: "domcontentloaded" });

    await expect(page.locator(".archive-item")).toHaveCount(history.length);
    await expect(page.locator(".archive-row")).toHaveCount(history.length);

    const hrefs = await page
      .locator(".archive-row-title a")
      .evaluateAll((links) => links.map((link) => new URL(link.href).pathname));

    expect(hrefs).toEqual(history.map((item) => item.permalink));
    expect(new Set(hrefs).size).toBe(history.length);
  });

  test("keeps the chronology: one chapter per year, oldest first", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Archive checks run once");

    await page.goto(ARCHIVE_PATH, { waitUntil: "domcontentloaded" });

    const yearLabels = await page
      .locator(".archive-year-label")
      .evaluateAll((labels) => labels.map((label) => label.textContent.trim()));
    expect(yearLabels).toEqual(historyYears.map((group) => String(group.year)));

    // Chronological: ascending years, and ascending dates inside each year.
    const years = yearLabels.map(Number);
    expect(years).toEqual([...years].sort((left, right) => left - right));

    const dates = await page
      .locator(".archive-row-meta time")
      .evaluateAll((times) => times.map((time) => time.getAttribute("datetime")));
    expect(dates).toEqual(history.map((item) => item.isoDate));
    expect(dates).toEqual([...dates].sort());
  });

  test("groups multiple stories under one year marker", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Archive checks run once");

    await page.goto(ARCHIVE_PATH, { waitUntil: "domcontentloaded" });

    const rowsPerYear = await page
      .locator(".archive-year")
      .evaluateAll((sections) =>
        sections.map((section) => section.querySelectorAll(".archive-row").length),
      );
    expect(rowsPerYear).toEqual(historyYears.map((group) => group.items.length));

    const multiStoryYears = historyYears.filter((group) => group.items.length > 1);
    expect(multiStoryYears.length).toBeGreaterThan(0);
    for (const group of multiStoryYears) {
      // The year appears once for all of its stories.
      await expect(
        page.locator(`#archive-year-${group.year}`),
      ).toHaveCount(1);
      await expect(
        page.locator(`#archive-year-${group.year}`),
      ).toHaveText(String(group.year));
    }
  });

  test("never lets current news into the archive", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Archive checks run once");

    await page.goto(ARCHIVE_PATH, { waitUntil: "domcontentloaded" });

    const text = await page.locator(".archive").innerText();
    for (const title of currentTitles) {
      expect(text).not.toContain(title);
    }

    const hrefs = await page
      .locator(".archive a[href]")
      .evaluateAll((links) => links.map((link) => new URL(link.href).pathname));
    for (const article of newsArchive.articles) {
      expect(hrefs).not.toContain(article.permalink);
    }
  });

  test("uses the article excerpt, trimmed only at sentence boundaries", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Archive checks run once");

    await page.goto(ARCHIVE_PATH, { waitUntil: "domcontentloaded" });

    const excerpts = await page
      .locator(".archive-row-excerpt")
      .evaluateAll((paragraphs) => paragraphs.map((paragraph) => paragraph.textContent.trim()));
    expect(excerpts).toHaveLength(history.length);

    excerpts.forEach((excerpt, index) => {
      const record = history[index];
      expect(excerpt.length).toBeLessThanOrEqual(260);
      // Complete sentences only, and always a prefix of the article's own copy.
      expect(excerpt).toMatch(/[.!?]$/);
      expect(record.excerpt.startsWith(excerpt)).toBe(true);
      // The card shows the excerpt, never the article body.
      expect(excerpt).not.toContain("<");
    });
  });

  test("renders each image without cropping it and marks newspaper cuttings", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Archive checks run once");

    await page.goto(ARCHIVE_PATH, { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      for (const image of document.images) image.loading = "eager";
      await Promise.all(
        [...document.images].filter((image) => !image.complete).map((image) => image.decode().catch(() => {})),
      );
    });

    const images = await page.locator(".archive-row-media img").evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          src: element.getAttribute("src"),
          alt: element.getAttribute("alt") ?? "",
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          natural: [element.naturalWidth, element.naturalHeight],
          loaded: element.complete && element.naturalWidth > 0,
        };
      }),
    );

    expect(images).toHaveLength(history.length);
    for (const image of images) {
      expect(image.alt.length).toBeGreaterThan(5);
      expect(image.loaded).toBe(true);
      expect(image.width).toBeGreaterThan(60);
      expect(image.height).toBeGreaterThan(40);
      // Nothing is cropped or stretched: the rendered shape matches the source.
      const renderedRatio = image.width / image.height;
      const sourceRatio = image.natural[0] / image.natural[1];
      expect(Math.abs(renderedRatio - sourceRatio)).toBeLessThan(0.05);
    }

    const clippingPanels = await page
      .locator(".archive-row-media.is-clipping")
      .count();
    const clippings = history.filter((item) => item.imageType === "clipping").length;
    expect(clippingPanels).toBe(clippings);
    expect(clippings).toBeGreaterThan(0);
  });

  test("carries the years and dates as text, not only as a rail", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Archive checks run once");

    await page.goto(ARCHIVE_PATH, { waitUntil: "domcontentloaded" });

    // The chronology must survive with images and CSS decoration removed.
    const headings = await page.locator(".archive h3").evaluateAll((nodes) =>
      nodes.map((node) => node.textContent.trim()),
    );
    expect(headings).toEqual(historyYears.map((group) => String(group.year)));

    const times = await page.locator(".archive time").evaluateAll((nodes) =>
      nodes.map((node) => node.textContent.trim()),
    );
    expect(times).toEqual(history.map((item) => item.displayDate));
  });

  test("links back to all news and across to the club history", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Archive checks run once");

    await page.goto(ARCHIVE_PATH, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("link", { name: "All news" }).first()).toHaveAttribute(
      "href",
      /news\.html$/,
    );
    await expect(page.getByRole("link", { name: /Read the club history/ })).toHaveAttribute(
      "href",
      /history\.html$/,
    );

    // The History page links back the other way.
    await page.goto("/history.html", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: /Explore the historical archive/ })).toHaveAttribute(
      "href",
      /news\/history\/index\.html$/,
    );
  });

  test("opens every historical article from the archive", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Archive checks run once");

    await page.goto(ARCHIVE_PATH, { waitUntil: "domcontentloaded" });

    const missing = history
      .map((item) => item.permalink)
      .filter((permalink) => !existsSync(path.join(SITE_ROOT, ...permalink.split("/").filter(Boolean), "index.html")));
    expect(missing).toEqual([]);

    // Follow the first row and confirm the article page and its way back.
    await page.locator(".archive-row-title a").first().click();
    await expect(page.locator(".article-header h2")).toHaveText(history[0].title);
    await expect(page.getByRole("link", { name: /Back to News & Events/ })).toBeVisible();
    // Historical articles carry their photographs inside the body.
    await expect(page.locator(".article-body img").first()).toBeVisible();
  });
});

test.describe("historical archive layout", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1280, "Layout checks run on tablet and mobile");

  test("uses a single column with the year above its stories", async ({ page }) => {
    await page.goto(ARCHIVE_PATH, { waitUntil: "domcontentloaded" });

    // Every row starts at the same left edge — no alternating zig-zag.
    const lefts = await page.locator(".archive-row").evaluateAll((rows) =>
      rows.map((row) => Math.round(row.getBoundingClientRect().left)),
    );
    expect(new Set(lefts).size).toBe(1);

    const yearPositions = await page.locator(".archive-year-label").evaluateAll((labels) =>
      labels.map((label) => Math.round(label.getBoundingClientRect().left)),
    );
    expect(new Set(yearPositions).size).toBe(1);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("keeps cards full width and images useful on a phone", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Phone checks run in the mobile project");

    await page.goto(ARCHIVE_PATH, { waitUntil: "domcontentloaded" });

    const widths = await page.locator(".archive-row").evaluateAll((rows) =>
      rows.map((row) => Math.round(row.getBoundingClientRect().width)),
    );
    const containerWidth = await page
      .locator(".archive")
      .evaluate((element) => Math.round(element.getBoundingClientRect().width));

    // Full-width cards, all the same width, close to the container.
    expect(new Set(widths).size).toBe(1);
    expect(widths[0]).toBeGreaterThan(containerWidth * 0.75);

    const image = await page.locator(".archive-row-media img").first().evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    });
    expect(image.width).toBeGreaterThan(120);
    expect(image.height).toBeGreaterThan(60);
  });
});

test("the archive renders in the night theme without console errors", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Night check runs on desktop");

  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("polmaise-theme", "dark");
    } catch (error) {
      /* storage unavailable */
    }
  });

  await page.goto(ARCHIVE_PATH, { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".archive-row").first()).toBeVisible();
  await expect(page.locator(".archive-year-label").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("records the archive inventory for the stage report", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Measurement runs once");

  const html = readFileSync(path.join(SITE_ROOT, "news", "history", "index.html"), "utf8");

  await writeMeasurement("historical-archive", {
    items: history.length,
    yearChapters: historyYears.length,
    multiStoryYears: historyYears.filter((group) => group.items.length > 1).length,
    clippings: history.filter((item) => item.imageType === "clipping").length,
    photographs: history.filter((item) => item.imageType === "photograph").length,
    archiveHtmlKiB: Math.round(html.length / 1024),
    longestCardExcerpt: Math.max(...history.map((item) => item.cardExcerpt.length)),
  });
});
