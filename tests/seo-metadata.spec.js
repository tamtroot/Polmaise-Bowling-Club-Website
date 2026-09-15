import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { compareOrUpdateBaseline, writeMeasurement } from "./helpers/baseline.mjs";
import { freezeBaselineClock } from "./helpers/baseline-clock.mjs";
import { SITE_PAGES } from "./helpers/site-pages.mjs";
import { SITE_ROOT, SOURCE_ROOT } from "./helpers/site-root.mjs";

/**
 * Stage 13 generates a page per news article plus year/category/historical
 * indexes. Only a representative sample is audited page-by-page, so the sitemap
 * check builds its expected list from the generated files themselves: every
 * published page must be listed, and nothing else may be.
 */
async function generatedNewsPageUrls() {
  const urls = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name === "index.html") {
        const relative = path.relative(SITE_ROOT, path.dirname(fullPath)).split(path.sep).join("/");
        urls.push(`/${relative}/`);
      }
    }
  };
  await walk(path.join(SITE_ROOT, "news"));
  return urls;
}

const site = JSON.parse(await readFile(path.join(SOURCE_ROOT, "_data", "site.json"), "utf8"));
/**
 * Canonical URLs drop the "index.html" a page is written to. The site root
 * becomes "/", and a Stage 13 news page written to
 * /news/2026/<slug>/index.html publishes /news/2026/<slug>/ — the address it is
 * linked with everywhere else on the site.
 *
 * SITE_PAGES paths are already URL-encoded.
 */
const canonicalFor = (sitePage) => {
  if (sitePage.path === "/index.html") return `${site.url}/`;
  if (sitePage.path.endsWith("/index.html")) {
    return `${site.url}${sitePage.path.slice(0, -"index.html".length)}`;
  }
  return `${site.url}${sitePage.path}`;
};

test("every public page carries complete, unique SEO metadata", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "SEO checks run once on desktop");

  const problems = [];
  const titles = new Map();
  const descriptions = new Map();

  for (const sitePage of SITE_PAGES) {
    await freezeBaselineClock(page);
    await page.goto(sitePage.path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(100);

    const metadata = await page.evaluate(() => {
      const meta = (selector) =>
        document.querySelector(selector)?.getAttribute("content") ?? null;
      const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')].map(
        (script) => {
          try {
            return { valid: true, data: JSON.parse(script.textContent) };
          } catch (error) {
            return { valid: false, error: error.message };
          }
        },
      );

      return {
        title: document.title,
        description: meta('meta[name="description"]'),
        canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
        ogTitle: meta('meta[property="og:title"]'),
        ogDescription: meta('meta[property="og:description"]'),
        ogType: meta('meta[property="og:type"]'),
        ogUrl: meta('meta[property="og:url"]'),
        ogImage: meta('meta[property="og:image"]'),
        ogSiteName: meta('meta[property="og:site_name"]'),
        twitterCard: meta('meta[name="twitter:card"]'),
        twitterImage: meta('meta[name="twitter:image"]'),
        htmlLang: document.documentElement.getAttribute("lang"),
        headings: [...document.querySelectorAll("h1")].map((heading) => heading.textContent.trim()),
        jsonLd,
      };
    });

    const expectedCanonical = canonicalFor(sitePage);
    if (metadata.title.length < 10) problems.push(`${sitePage.path}: title too short`);
    if (!metadata.description || metadata.description.length < 50) {
      problems.push(`${sitePage.path}: missing or too short meta description`);
    }
    if (metadata.canonical !== expectedCanonical) {
      problems.push(`${sitePage.path}: canonical ${metadata.canonical} != ${expectedCanonical}`);
    }
    if (metadata.ogTitle !== metadata.title) {
      problems.push(`${sitePage.path}: og:title ${metadata.ogTitle} != title`);
    }
    if (metadata.ogDescription !== metadata.description) {
      problems.push(`${sitePage.path}: og:description differs from description`);
    }
    if (metadata.ogUrl !== expectedCanonical) {
      problems.push(`${sitePage.path}: og:url ${metadata.ogUrl} != ${expectedCanonical}`);
    }
    if (!["website", "article"].includes(metadata.ogType)) {
      problems.push(`${sitePage.path}: unexpected og:type ${metadata.ogType}`);
    }
    if (!metadata.ogImage?.startsWith(`${site.url}/`)) {
      problems.push(`${sitePage.path}: og:image is not an absolute site URL`);
    }
    if (!metadata.twitterCard) problems.push(`${sitePage.path}: missing twitter:card`);
    if (!metadata.twitterImage) problems.push(`${sitePage.path}: missing twitter:image`);
    if (metadata.htmlLang !== "en") problems.push(`${sitePage.path}: html lang is ${metadata.htmlLang}`);
    if (metadata.headings.length !== 1) {
      problems.push(`${sitePage.path}: ${metadata.headings.length} h1 elements`);
    }

    if (metadata.jsonLd.length === 0) {
      problems.push(`${sitePage.path}: no JSON-LD`);
    }
    for (const block of metadata.jsonLd) {
      if (!block.valid) {
        problems.push(`${sitePage.path}: invalid JSON-LD (${block.error})`);
        continue;
      }
      const types = [].concat(block.data["@graph"] ?? []).map((node) => node["@type"]);
      if (!types.includes("SportsOrganization") || !types.includes("WebSite")) {
        problems.push(`${sitePage.path}: JSON-LD missing SportsOrganization/WebSite`);
      }
      if (metadata.ogType === "article" && !types.includes("Article")) {
        problems.push(`${sitePage.path}: article page JSON-LD missing Article`);
      }
      const organisation = [].concat(block.data["@graph"] ?? []).find(
        (node) => node["@type"] === "SportsOrganization",
      );
      if (organisation?.address?.streetAddress !== site.address.streetAddress) {
        problems.push(`${sitePage.path}: organisation address missing`);
      }
    }

    const titleOwner = titles.get(metadata.title);
    if (titleOwner) {
      problems.push(`${sitePage.path}: duplicate title also used by ${titleOwner}`);
    }
    titles.set(metadata.title, sitePage.path);

    const descriptionOwner = descriptions.get(metadata.description);
    if (descriptionOwner) {
      problems.push(`${sitePage.path}: duplicate description also used by ${descriptionOwner}`);
    }
    descriptions.set(metadata.description, sitePage.path);
  }

  await compareOrUpdateBaseline(testInfo, "seo-metadata/problems", problems);
  await writeMeasurement("seo-metadata", {
    publicPageCount: SITE_PAGES.length,
    uniqueTitleCount: titles.size,
    uniqueDescriptionCount: descriptions.size,
    problemCount: problems.length,
  });
});

test("sitemap and robots files list exactly the public pages", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "SEO checks run once on desktop");

  const sitemapResponse = await request.get("/sitemap.xml");
  expect(sitemapResponse.status()).toBe(200);
  const sitemap = await sitemapResponse.text();
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  const expected = [
    ...SITE_PAGES.map(canonicalFor),
    ...(await generatedNewsPageUrls()).map((url) => `${site.url}${url}`),
  ]
    .filter((url, index, urls) => urls.indexOf(url) === index)
    .sort();

  const missing = expected.filter((url) => !locs.includes(url));
  const unexpected = locs.filter((url) => !expected.includes(url));

  const robotsResponse = await request.get("/robots.txt");
  expect(robotsResponse.status()).toBe(200);
  const robots = await robotsResponse.text();

  await compareOrUpdateBaseline(testInfo, "seo-metadata/sitemap-missing", missing);
  await compareOrUpdateBaseline(testInfo, "seo-metadata/sitemap-unexpected", unexpected);
  await compareOrUpdateBaseline(
    testInfo,
    "seo-metadata/robots-issues",
    robots.includes(`Sitemap: ${site.url}/sitemap.xml`) ? [] : ["robots.txt does not reference the sitemap"],
  );

  await writeMeasurement("seo-sitemap", {
    sitemapUrlCount: locs.length,
    expectedPageCount: expected.length,
    missingCount: missing.length,
    unexpectedCount: unexpected.length,
    robotsReferencesSitemap: robots.includes(`Sitemap: ${site.url}/sitemap.xml`),
  });
});
