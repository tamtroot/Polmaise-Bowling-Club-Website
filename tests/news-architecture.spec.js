import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import newsArchive from "../_data/newsArchive.js";
import { formatNewsDate } from "../tools/news-dates.mjs";
import { TITLE_LIMIT } from "../tools/document-titles.mjs";
import { compareOrUpdateBaseline, writeMeasurement } from "./helpers/baseline.mjs";
import { SITE_ROOT } from "./helpers/site-root.mjs";

/**
 * Stage 13 — the generated news section.
 *
 * The published pages are produced from `news/**` by the templates in
 * `news/` + `_includes/news-article.njk`, and the numbers on the landing page
 * come from `_data/newsArchive.js`. These tests read both: the data file says
 * what should exist, the build output says what did.
 */
const siteRoot = SITE_ROOT;

/** Every generated article page (one directory per permalink). */
async function articlePageFiles() {
  const pages = [];
  for (const directory of ["2026", "2025", "history"]) {
    const root = path.join(siteRoot, "news", directory);
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(root, entry.name, "index.html");
      if ((await stat(file).catch(() => null))?.isFile()) pages.push(file);
    }
  }
  return pages;
}

const allArticles = [...newsArchive.articles, ...newsArchive.history];

const permalinkToFile = (permalink) =>
  path.join(siteRoot, ...permalink.split("/").filter(Boolean), "index.html");

/** All hrefs on a page, as site-root-relative paths. */
const hrefsOn = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("a[href]")].map((anchor) => {
      const url = new URL(anchor.getAttribute("href"), window.location.href);
      return `${url.pathname}${url.hash}`;
    }),
  );

test.describe("news landing page", () => {
  test("is an editorial front page: featured, latest, more news, categories, archive", async ({
    page,
  }) => {
    await page.goto("/news.html", { waitUntil: "domcontentloaded" });

    const featuredHref = await page
      .locator(".news-lead .news-lead-body h2 a")
      .first()
      .evaluate((link) => new URL(link.href).pathname);
    expect(featuredHref).toBe(newsArchive.featured.permalink);

    const headings = await page.locator(".news-section-head h2").allInnerTexts();
    expect(headings).toEqual([
      "Latest from Polmaise",
      "More from the club",
      "By category",
      "Browse the archives",
    ]);

    // Featured story, then the next three headlines, then every remaining
    // current story in the compact list — each exactly once.
    await expect(page.locator(".news-grid .news-card")).toHaveCount(newsArchive.latest.length);
    await expect(page.locator(".news-list li")).toHaveCount(newsArchive.more.length);

    const cardHrefs = await page
      .locator(".news-grid .news-card-title a, .news-list a")
      .evaluateAll((links) => links.map((link) => new URL(link.href).pathname));
    expect(cardHrefs).toHaveLength(newsArchive.articles.length - 1);
    expect(new Set(cardHrefs).size).toBe(cardHrefs.length);
    expect(cardHrefs).not.toContain(newsArchive.featured.permalink);
  });

  test("links to every published story and never to a historical item", async ({ page }) => {
    await page.goto("/news.html", { waitUntil: "domcontentloaded" });
    const hrefs = await hrefsOn(page);

    const missing = newsArchive.articles
      .map((article) => article.permalink)
      .filter((permalink) => !hrefs.includes(permalink));
    expect(missing).toEqual([]);

    const historyLinks = newsArchive.history
      .map((item) => item.permalink)
      .filter((permalink) => hrefs.includes(permalink));
    expect(historyLinks).toEqual([]);

    expect(hrefs).toContain("/news/history/index.html");
    expect(hrefs).toContain("/news/2026/index.html");
    expect(hrefs).toContain("/news/2025/index.html");
  });
});

test.describe("news collection", () => {
  test("publishes one page per article, once, straight from the source files", async ({
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Collection checks run once");

    const pages = await articlePageFiles();
    expect(pages).toHaveLength(allArticles.length);

    const permalinks = allArticles.map((article) => article.permalink);
    expect(new Set(permalinks).size).toBe(permalinks.length);

    const missing = [];
    for (const permalink of permalinks) {
      const file = permalinkToFile(permalink);
      if (!(await stat(file).catch(() => null))?.isFile()) missing.push(permalink);
    }
    expect(missing).toEqual([]);
  });

  test("counts match the sections: 33 current stories, 12 in 2026 and 21 in 2025", async ({
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Collection checks run once");

    expect(newsArchive.articles).toHaveLength(33);
    expect(newsArchive.history).toHaveLength(10);
    expect(newsArchive.years.map((group) => [group.year, group.articles.length])).toEqual([
      [2026, 12],
      [2025, 21],
    ]);
    expect(newsArchive.counts).toMatchObject({
      articles: 33,
      featured: 1,
      latest: 3,
      more: 29,
      history: 10,
    });
  });

  test("keeps the current stream newest first, with the undated notice last", async ({
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Collection checks run once");

    const dated = newsArchive.articles.filter((article) => article.isoDate);
    const sorted = [...dated].sort((left, right) => right.isoDate.localeCompare(left.isoDate));

    expect(dated).toEqual(sorted);
    const undated = newsArchive.articles.filter((article) => !article.isoDate);
    expect(undated).toHaveLength(1);
    expect(newsArchive.articles.at(-1)).toBe(undated[0]);
  });

  test("files every current story into exactly one category group", async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Collection checks run once");

    const grouped = newsArchive.categories.flatMap((group) => group.articles);
    expect(grouped).toHaveLength(newsArchive.articles.length);
    expect(new Set(grouped.map((article) => article.permalink)).size).toBe(
      newsArchive.articles.length,
    );

    for (const group of newsArchive.categories) {
      expect(group.articles.length).toBeGreaterThan(0);
      const file = path.join(siteRoot, "news", "category", group.slug, "index.html");
      expect((await stat(file)).isFile()).toBe(true);
    }
  });
});

test.describe("news archives", () => {
  for (const group of newsArchive.years) {
    test(`${group.year} archive lists all ${group.articles.length} stories`, async ({ page }) => {
      await page.goto(`/news/${group.year}/index.html`, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".news-grid .news-card")).toHaveCount(group.articles.length);

      const hrefs = await hrefsOn(page);
      const missing = group.articles
        .map((article) => article.permalink)
        .filter((permalink) => !hrefs.includes(permalink));
      expect(missing).toEqual([]);
    });
  }

  test("historical archive lists every item and links to each page", async ({ page }) => {
    await page.goto("/news/history/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".archive-item")).toHaveCount(newsArchive.history.length);

    const hrefs = await hrefsOn(page);
    const missing = newsArchive.history
      .map((item) => item.permalink)
      .filter((permalink) => !hrefs.includes(permalink));
    expect(missing).toEqual([]);
  });

  test("category pages show the stories in their group", async ({ page }) => {
    for (const group of newsArchive.categories) {
      await page.goto(`/news/category/${group.slug}/index.html`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.locator(".news-grid .news-card")).toHaveCount(group.articles.length);
    }
  });
});

test.describe("homepage news automation", () => {
  test("shows the three newest published stories", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });

    const expected = newsArchive.articles
      .slice(0, 3)
      .map((article) => article.permalink.replace(/^\//, ""));
    const actual = await page
      .locator(".home-story-title a")
      .evaluateAll((links) => links.map((link) => new URL(link.href).pathname.replace(/^\//, "")));

    expect(actual).toEqual(expected);
  });
});

test.describe("article pages", () => {
  const representative = [
    newsArchive.featured,
    newsArchive.articles.find((article) => article.year === 2025 && article.isoDate),
    newsArchive.history[0],
  ];

  for (const article of representative) {
    test(`${article.permalink} shows date, category, image and navigation`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "Article metadata is checked once");

      await page.goto(article.permalink, { waitUntil: "domcontentloaded" });

      await expect(page.locator(".article-header h2")).toHaveText(article.title);
      await expect(page.locator(".article-header .news-meta-row time")).toHaveText(
        article.displayDate,
      );
      await expect(page.locator(".article-header .news-chip")).toHaveText(
        article.section === "history" ? "History" : article.category,
      );

      const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
      expect(canonical.endsWith(article.permalink)).toBe(true);
      await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "article");

      const hero = page.locator(".article-hero img, .article-body img").first();
      const box = await hero.boundingBox();
      expect(box.width).toBeGreaterThan(100);
      expect((await hero.getAttribute("alt"))?.length ?? 0).toBeGreaterThan(0);

      await expect(page.getByRole("link", { name: /Back to News & Events/i })).toBeVisible();
      await expect(page.locator(".article-nav")).toBeVisible();
    });
  }

  test("article titles stay in the document flow while the page scrolls", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Scroll behaviour is checked once");

    await page.goto(newsArchive.featured.permalink, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);

    const before = await page.evaluate(() => {
      const header = document.querySelector(".article-header");
      const rect = header.getBoundingClientRect();
      return {
        position: getComputedStyle(header).position,
        documentTop: Math.round(rect.top + window.scrollY),
      };
    });
    expect(before.position).toBe("static");

    await page.evaluate(() =>
      window.scrollTo(0, Math.min(document.body.scrollHeight - innerHeight, innerHeight * 2)),
    );
    const after = await page.evaluate(() => ({
      viewportTop: Math.round(document.querySelector(".article-header").getBoundingClientRect().top),
      scrollY: Math.round(window.scrollY),
    }));

    // The title must have travelled with the document, not stayed pinned.
    expect(after.scrollY).toBeGreaterThan(200);
    expect(after.viewportTop).toBeLessThan(0);
  });

  test("every generated news page loads the shared site script and header controls", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Shared asset checks run once");

    const pages = [
      "/news.html",
      newsArchive.featured.permalink,
      "/news/2026/index.html",
      "/news/history/index.html",
      "/news/category/competition/index.html",
    ];

    for (const path of pages) {
      await page.goto(path, { waitUntil: "domcontentloaded" });

      // script.js drives the mobile menu, the theme toggle and the image
      // lightbox; an article template that forgets `scriptJs` ships a header
      // whose burger button does nothing.
      expect(await page.locator('script[src$="script.js"]').count(), path).toBe(1);
      await expect(page.locator("#mobileMenuButton i")).toHaveClass(/fa-/, { timeout: 5000 });
      await expect(page.locator("[data-theme-toggle]")).toBeVisible();
    }
  });
});

test("dates are written once, in one human-readable style", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Date formatting is checked once");

  const pages = [
    path.join(siteRoot, "news.html"),
    ...(await articlePageFiles()),
    path.join(siteRoot, "news", "2026", "index.html"),
    path.join(siteRoot, "news", "2025", "index.html"),
    path.join(siteRoot, "news", "history", "index.html"),
  ];

  const problems = [];
  const machineReadable = /^<time datetime="(\d{4}-\d{2}-\d{2})">(.+)<\/time>$/;

  for (const file of pages) {
    const html = await readFile(file, "utf8");
    const relative = path.relative(siteRoot, file).split(path.sep).join("/");

    for (const pattern of [/\bGMT\b/, /Greenwich/, /\bBritish Summer Time\b/, /\b[A-Z]{3} [A-Z][a-z]{2} \d{2} \d{4}\b/]) {
      if (pattern.test(html)) problems.push(`${relative}: date leaks runtime output (${pattern})`);
    }

    for (const match of html.matchAll(/<time datetime="([^"]*)">([^<]*)<\/time>/g)) {
      const [, isoDate, label] = match;
      if (!isoDate) continue;
      if (label !== formatNewsDate(isoDate)) {
        problems.push(`${relative}: <time> shows "${label}" instead of "${formatNewsDate(isoDate)}"`);
      }
      if (!machineReadable.test(match[0])) problems.push(`${relative}: ${match[0]}`);
    }
  }

  await compareOrUpdateBaseline(testInfo, "news-architecture/date-format", problems);
  expect(problems).toEqual([]);
});

test("every generated news page keeps its document title inside the limit", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Title checks run once");

  const problems = [];
  const pages = [
    path.join(siteRoot, "news.html"),
    ...(await articlePageFiles()),
    path.join(siteRoot, "news", "2026", "index.html"),
    path.join(siteRoot, "news", "2025", "index.html"),
    path.join(siteRoot, "news", "history", "index.html"),
    ...newsArchive.categories.map((group) =>
      path.join(siteRoot, "news", "category", group.slug, "index.html"),
    ),
  ];

  for (const file of pages) {
    const html = await readFile(file, "utf8");
    const relative = path.relative(siteRoot, file).split(path.sep).join("/");
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";

    // html-validate measures the serialised title text, entity references and
    // all, so the raw characters are what count here.
    if (title.length > TITLE_LIMIT) {
      problems.push(`${relative}: title is too long`);
    }
  }

  await compareOrUpdateBaseline(testInfo, "news-architecture/title-length", problems);
  expect(problems).toEqual([]);
});

test("sitemap lists every generated news page", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Sitemap checks run once");

  const sitemap = await (await request.get("/sitemap.xml")).text();
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

  const expected = [
    ...allArticles.map((article) => article.permalink),
    ...newsArchive.years.map((group) => `/news/${group.year}/`),
    ...newsArchive.categories.map((group) => `/news/category/${group.slug}/`),
    "/news/history/",
    "/news.html",
  ];

  const missing = expected.filter((permalink) => !locs.some((loc) => loc.endsWith(permalink)));
  expect(missing).toEqual([]);

  await writeMeasurement("news-architecture", {
    currentArticles: newsArchive.articles.length,
    articles2026: newsArchive.years.find((group) => group.year === 2026)?.articles.length ?? 0,
    articles2025: newsArchive.years.find((group) => group.year === 2025)?.articles.length ?? 0,
    historicalItems: newsArchive.history.length,
    landingCards: newsArchive.latest.length + newsArchive.more.length,
    categoryCounts: Object.fromEntries(
      newsArchive.categories.map((group) => [group.name, group.articles.length]),
    ),
    sitemapUrlCount: locs.length,
  });
});
