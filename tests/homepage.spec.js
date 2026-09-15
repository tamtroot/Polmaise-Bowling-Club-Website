import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { SITE_ROOT } from "./helpers/site-root.mjs";

/**
 * Stage 12 homepage.
 *
 * The homepage was rebuilt as an editorial front page: hero, feature strip,
 * news, schedule, history, gallery, membership and sponsors. These tests cover
 * its structure, its links, both themes, the responsive widths from the brief,
 * and — because the real 2026 season is complete — the deliberate
 * season-complete state. The layout with upcoming fixtures is covered by
 * `tests/homepage-fixtures.spec.js`, which builds a second copy of the site
 * from synthetic fixture data.
 */

const WIDTHS = [375, 768, 1024, 1280, 1440];

const SECTION_ORDER = [
  "home-hero",
  "home-features",
  "home-news",
  "home-schedule",
  "home-history",
  "home-gallery",
  "home-join",
  "home-sponsors",
];

test.describe("homepage", () => {
  test("is assembled from the intended sections in order", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });

    const classes = await page.evaluate(() =>
      [...document.querySelectorAll("main > section")].map(
        (section) => [...section.classList].find((name) => name.startsWith("home-")) ?? "unknown",
      ),
    );
    expect(classes).toEqual(SECTION_ORDER);

    // One page h1 (the header wordmark) and a single h2 per section.
    await expect(page.locator("h1")).toHaveCount(1);
    for (const section of SECTION_ORDER) {
      const headings = page.locator(`.${section} h2`);
      const count = await headings.count();
      expect(count, `${section} should carry one h2`).toBeLessThanOrEqual(
        section === "home-features" ? 0 : 1,
      );
    }
  });

  test("hero offers the three primary routes and keeps its copy", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });

    await expect(page.locator("#home-hero-title")).toHaveText("Polmaise Bowling Club");
    await expect(page.locator(".home-hero-tagline")).toHaveText("Tradition, Community, Excellence");
    // Grounded wording: no age-range, accessibility or inclusivity claims.
    await expect(page.locator(".home-hero-intro")).toHaveText(
      "At the heart of Fallin since 1911. A friendly local club with a proud history, competitive bowls and a strong community spirit.",
    );

    const actions = page.locator(".home-hero-actions a");
    await expect(actions).toHaveCount(3);
    await expect(actions.nth(0)).toHaveAttribute("href", "membership.html");
    await expect(actions.nth(1)).toHaveAttribute("href", "fixtures.html");
    await expect(actions.nth(2)).toHaveAttribute("href", "news.html");

    // The hero photograph is above the fold, so it must not be lazy-loaded
    // (`loading: false` omits the attribute, which is the eager default).
    const heroImage = page.locator(".home-hero-media img");
    expect(await heroImage.getAttribute("loading")).not.toBe("lazy");
    await expect(heroImage).toHaveAttribute("alt", /Polmaise Bowling Club/);
  });

  test("publishes the three most recent stories with photography and links", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });

    const cards = page.locator(".home-story");
    await expect(cards).toHaveCount(3);

    // Stage 13: the homepage renders the newest published articles and links
    // straight to each article page rather than back to the news landing page.
    const hrefs = [];
    for (let index = 0; index < 3; index += 1) {
      const card = cards.nth(index);
      const href = await card.locator("h3 a").getAttribute("href");
      expect(href, `story ${index + 1} should link to its article page`).toMatch(
        /^news\/\d{4}\/[a-z0-9-]+\/$/,
      );
      hrefs.push(href);
      await expect(card.locator("time")).not.toBeEmpty();
      await expect(card.locator("img")).toHaveAttribute("alt", /.{10,}/);
      // Every card image must actually load.
      const loaded = await card
        .locator("img")
        .evaluate((image) => image.complete && image.naturalWidth > 0);
      expect(loaded, `story ${index + 1} image should load`).toBe(true);
    }
    // Newest first, and never the same story twice.
    expect(new Set(hrefs).size).toBe(3);
    const dates = await page
      .locator(".home-story time")
      .evaluateAll((elements) => elements.map((element) => element.getAttribute("datetime")));
    expect(dates).toEqual([...dates].sort().reverse());

    await expect(page.locator(".home-news .home-section-link")).toHaveAttribute(
      "href",
      "news.html",
    );
  });

  test("shows either upcoming fixtures or the deliberate season-complete state", async ({
    page,
  }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });

    const list = page.locator(".home-schedule-list");
    const empty = page.locator(".home-empty");
    const hasList = (await list.count()) > 0;
    const hasEmpty = (await empty.count()) > 0;

    expect(hasList !== hasEmpty, "exactly one schedule state should render").toBe(true);

    if (hasEmpty) {
      await expect(empty.locator(".home-empty-title")).toHaveText("Season complete");
      const copy = await empty.locator(".home-empty-copy").innerText();
      expect(copy).toMatch(/no more scheduled fixtures this season/i);
      expect(copy).not.toMatch(/not found|no fixtures found/i);
      await expect(empty.locator("a[href='fixtures.html']")).toHaveCount(1);
    } else {
      await expect(list.locator(".home-schedule-item").first()).toBeVisible();
    }

    // The feature strip always answers "what's next?" in some form.
    await expect(page.locator(".home-features")).toContainText(/next fixture/i);
  });

  test("gallery and sponsor strips use real, loaded images", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      const images = [...document.images];
      for (const image of images) image.loading = "eager";
      await Promise.all(
        images.filter((image) => !image.complete).map((image) => image.decode().catch(() => {})),
      );
    });

    const gallery = page.locator(".home-gallery-strip img");
    await expect(gallery).toHaveCount(6);
    // Curated album covers are honoured: the Bone family album nominates a
    // cover rather than falling back to the first image in the album.
    const coverSources = await gallery.evaluateAll((images) =>
      images.map((image) => image.getAttribute("src")),
    );
    expect(coverSources[3]).toContain("FB_IMG_1753006294768");
    const galleryLoaded = await gallery.evaluateAll((images) =>
      images.map((image) => ({
        alt: image.getAttribute("alt"),
        loaded: image.complete && image.naturalWidth > 0,
      })),
    );
    for (const image of galleryLoaded) {
      expect(image.alt, "gallery images need alt text").toBeTruthy();
      expect(image.loaded, `${image.alt} should load`).toBe(true);
    }

    const sponsors = page.locator(".home-sponsor-strip img");
    await expect(sponsors).toHaveCount(6);
    // Every sponsor tile is the same size, and each logo is contained inside
    // its own display area rather than resized by its source canvas.
    const tiles = await page.locator(".home-sponsor-strip a").evaluateAll((anchors) => {
      const boxes = anchors.map((anchor) => {
        const rect = anchor.getBoundingClientRect();
        return [Math.round(rect.width), Math.round(rect.height)];
      });
      const fit = anchors.map((anchor) => getComputedStyle(anchor.querySelector("img")).objectFit);
      return { boxes, fit };
    });
    expect(new Set(tiles.boxes.map((box) => box.join("x"))).size).toBe(1);
    expect(tiles.fit.every((value) => value === "contain")).toBe(true);
    await expect(page.locator(".home-sponsors-support")).toHaveText(
      "Proudly supported by local businesses",
    );
    const sponsorLoaded = await sponsors.evaluateAll((images) =>
      images.map((image) => ({
        alt: image.getAttribute("alt"),
        loaded: image.complete && image.naturalWidth > 0,
      })),
    );
    for (const image of sponsorLoaded) {
      expect(image.alt, "sponsor logos need alt text").toBeTruthy();
      expect(image.loaded, `${image.alt} should load`).toBe(true);
    }
  });

  test("every homepage section stays inside the viewport in both themes", async ({ page }) => {
    for (const theme of ["light", "dark"]) {
      if (theme === "dark") {
        await page.addInitScript(() => {
          try {
            window.localStorage.setItem("polmaise-theme", "dark");
          } catch (error) {
            /* storage unavailable */
          }
        });
      }
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/index.html", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(120);

        const overflow = await page.evaluate(() => {
          const offenders = [];
          for (const element of document.querySelectorAll("body *")) {
            const rect = element.getBoundingClientRect();
            if (rect.width === 0) continue;
            if (rect.right > window.innerWidth + 1 || rect.left < -1) {
              offenders.push(
                `${element.tagName.toLowerCase()}.${[...element.classList].join(".")} (${Math.round(rect.left)}..${Math.round(rect.right)})`,
              );
            }
          }
          return {
            document: document.documentElement.scrollWidth - window.innerWidth,
            offenders: offenders.slice(0, 5),
          };
        });
        expect(
          overflow,
          `${theme} @ ${width}px: content overflowed the viewport`,
        ).toEqual({ document: 0, offenders: [] });
      }
    }
  });

  test("the built homepage does not contain test-only fixture data", async () => {
    const html = await readFile(path.join(SITE_ROOT, "index.html"), "utf8");
    expect(html).not.toContain("data-test-fixtures");
    expect(html).not.toContain("Stage 12 synthetic");
  });
});
