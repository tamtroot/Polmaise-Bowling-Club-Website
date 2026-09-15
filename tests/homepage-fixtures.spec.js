import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createStaticServer } from "../tools/static-server.mjs";

/**
 * The 2026 season is complete, so production has no future fixtures and the
 * homepage renders its season-complete state. This spec builds a second copy of
 * the site with a synthetic upcoming fixture list so the normal "Next Fixture"
 * and "This Week at the Club" layouts are still exercised, then proves that the
 * synthetic data cannot reach the published site.
 *
 * The variant build is driven by STAGE12_TEST_FIXTURES (read by
 * `_data/homepage.js`); production builds never set it.
 */
const VARIANT_ROOT = "_site-stage12-variant";
const SYNTHETIC = [
  {
    date: "04-Apr",
    competition: "Stage 12 synthetic fixture",
    day: "Saturday",
    venue: "Polmaise",
    status: "Confirmed",
  },
  {
    date: "11-Apr",
    competition: "Stage 12 synthetic away fixture",
    day: "Saturday",
    venue: "Menstrie",
    status: "TBC",
  },
];

test.describe("homepage fixture layouts", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1280, "Build checks run once on desktop");

  // This spec builds a second copy of the whole site (2,900+ deployed images)
  // inside the test, which needs far more than the default 45 second budget on
  // a cloud-synced working copy. The nested build's own timeout is 240s; give
  // the test room to match so a slow build cannot leave a build process behind.
  test.setTimeout(300_000);

  test("renders the next fixture and schedule when fixtures exist", async ({ page }) => {
    const projectRoot = process.cwd();
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "polmaise-fixtures-"));
    const variantRoot = VARIANT_ROOT;
    const fixtureFile = path.join(temporaryDirectory, "fixtures.json");
    await writeFile(fixtureFile, `${JSON.stringify(SYNTHETIC, null, 2)}\n`, "utf8");

    let server;
    try {
      execFileSync(process.execPath, ["tools/build-site.mjs"], {
        cwd: projectRoot,
        env: {
          ...process.env,
          SITE_ROOT: variantRoot,
          IMAGE_CACHE_ROOT: process.env.IMAGE_CACHE_ROOT ?? path.join(".cache-alt", "images"),
          STAGE12_TEST_FIXTURES: fixtureFile,
          // The layout assertions never look at a photograph, and deploying
          // 2,900 image derivatives into this throwaway copy is what made the
          // nested build outlast its own timeout.
          SKIP_IMAGE_PIPELINE: "true",
        },
        stdio: "pipe",
        timeout: 240_000,
      });

      const variantIndex = await readFile(
        path.join(projectRoot, variantRoot, "index.html"),
        "utf8",
      );
      expect(variantIndex).toContain('data-test-fixtures="true"');
      expect(variantIndex).toContain("Stage 12 synthetic fixture");

      // The production build served by the shared webServer must stay clean.
      const productionIndex = await readFile(
        path.join(projectRoot, process.env.SITE_ROOT ?? "_site", "index.html"),
        "utf8",
      );
      expect(productionIndex).not.toContain("Stage 12 synthetic fixture");
      expect(productionIndex).not.toContain('data-test-fixtures="true"');

      // Serve the variant and check the rendered layouts.
      const port = 4198;
      server = createStaticServer(path.join(projectRoot, variantRoot));
      await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

      await page.goto(`http://127.0.0.1:${port}/index.html`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});

      // Feature strip: the real "Next Fixture" layout.
      const nextFixture = page.locator(".home-features .home-feature").first();
      await expect(nextFixture).toContainText("Stage 12 synthetic fixture");
      await expect(nextFixture).not.toContainText("Season complete");
      await expect(nextFixture).toContainText("Polmaise");

      // Schedule: rows instead of the season-complete panel.
      await expect(page.locator(".home-schedule-list")).toBeVisible();
      await expect(page.locator(".home-empty")).toHaveCount(0);
      const rows = page.locator(".home-schedule-item");
      await expect(rows).toHaveCount(SYNTHETIC.length);
      await expect(rows.nth(0)).toContainText("Stage 12 synthetic fixture");
      await expect(rows.nth(1)).toContainText("Stage 12 synthetic away fixture");
      await expect(rows.nth(1).locator(".home-schedule-status")).toHaveText("TBC");
      await expect(rows.nth(1).locator(".home-schedule-status")).toHaveClass(/is-tbc/);
    } finally {
      if (server) server.close();
      await rm(temporaryDirectory, { recursive: true, force: true });
      await rm(path.join(projectRoot, variantRoot), { recursive: true, force: true });
    }
  });
});
