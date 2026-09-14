import { test } from "@playwright/test";
import { compareOrUpdateBaseline, writeMeasurement } from "./helpers/baseline.mjs";
import { freezeBaselineClock } from "./helpers/baseline-clock.mjs";
import { SITE_PAGES } from "./helpers/site-pages.mjs";

test("every image reference resolves and renders", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Image checks run once on desktop");

  const brokenImages = [];
  const failedRequests = [];
  const uniqueReferences = new Set();

  for (const sitePage of SITE_PAGES) {
    await freezeBaselineClock(page);
    await page.goto(sitePage.path, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(400);

    const collected = await page.evaluate(() => {
      const references = new Set();
      const broken = [];

      // Candidates are comma separated and end with a "400w"/"2x" descriptor;
      // the URLs themselves may contain spaces.
      const addSrcset = (value) => {
        if (!value) {
          return;
        }
        for (const candidate of value.split(",")) {
          const url = candidate.trim().replace(/\s+\d+(?:\.\d+)?[wx]$/, "");
          if (url) {
            references.add(url);
          }
        }
      };

      for (const image of document.querySelectorAll("img")) {
        const src = image.getAttribute("src");
        // The lightbox placeholder image has no src until a photo is opened.
        if (!src) {
          continue;
        }
        if (src) {
          references.add(src);
        }
        addSrcset(image.getAttribute("srcset"));
        if (image.currentSrc) {
          references.add(image.currentSrc);
        }
        // A completed image with no intrinsic size means the browser tried and
        // failed, which is exactly the regression this test guards against.
        if (image.complete && image.naturalWidth === 0) {
          broken.push(src);
        }
      }

      for (const source of document.querySelectorAll("source[srcset]")) {
        addSrcset(source.getAttribute("srcset"));
      }

      for (const link of document.querySelectorAll("a[data-lightbox]")) {
        const href = link.getAttribute("href");
        if (href) {
          references.add(href);
        }
      }

      for (const element of document.querySelectorAll("*")) {
        const background = getComputedStyle(element).backgroundImage;
        if (background && background !== "none") {
          for (const match of background.matchAll(/url\((?:"|')?([^"')]+)(?:"|')?\)/g)) {
            references.add(match[1]);
          }
        }
      }

      return {
        references: [...references].map((value) => new URL(value, document.baseURI).href),
        broken,
      };
    });

    for (const reference of collected.references) {
      uniqueReferences.add(reference);
    }
    for (const broken of collected.broken) {
      brokenImages.push(`${sitePage.path} -> ${broken}`);
    }
  }

  // Verify each distinct image is actually served (HEAD keeps this cheap).
  const urls = [...uniqueReferences].filter((url) => url.startsWith("http"));
  const batchSize = 16;
  for (let index = 0; index < urls.length; index += batchSize) {
    const batch = urls.slice(index, index + batchSize);
    const responses = await Promise.all(
      batch.map(async (url) => ({ url, response: await request.head(url).catch(() => null) })),
    );
    for (const { url, response } of responses) {
      if (!response || !response.ok() || Number(response.headers()["content-length"] ?? 1) === 0) {
        failedRequests.push(`${url} -> ${response ? response.status() : "no response"}`);
      }
    }
  }

  await compareOrUpdateBaseline(testInfo, "image-references/broken-images", brokenImages);
  await compareOrUpdateBaseline(
    testInfo,
    "image-references/unresolved",
    failedRequests,
  );
  await writeMeasurement("image-references", {
    publicPageCount: SITE_PAGES.length,
    checkedImageCount: urls.length,
    brokenImageCount: brokenImages.length,
    unresolvedCount: failedRequests.length,
  });
});
