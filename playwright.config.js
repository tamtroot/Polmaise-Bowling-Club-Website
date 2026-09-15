import { defineConfig } from "@playwright/test";

const host = "127.0.0.1";
const port = 4173;
const baseURL = `http://${host}:${port}`;

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  metadata: {
    updateBaseline: process.argv.includes("--update-snapshots"),
  },
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.002,
      threshold: 0.2,
    },
  },
  reporter: [
    ["list"],
    ["json", { outputFile: "reports/latest/playwright-results.json" }],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  /*
   * Screenshot baselines live here, but the visual suite is *optional* QA: the
   * release gate (`npm run test:ci`) does not compare screenshots, because
   * Chromium rasterises text with the platform's own stack (DirectWrite on
   * Windows, FreeType on Linux) and those differences say nothing about whether
   * a visitor can use the site. The accepted PNGs were captured on Windows and
   * are for local design review (`npm run test:visual`); on another OS,
   * regenerate your own with `npm run baseline:update`.
   */
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}",
  use: {
    baseURL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: {
    command: `node tools/static-server.mjs --root ${process.env.SITE_ROOT ?? "_site"} --port ${port}`,
    url: `${baseURL}/index.html`,
    reuseExistingServer: true,
    timeout: 15_000,
  },
  projects: [
    {
      name: "desktop",
      use: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: "tablet",
      use: {
        viewport: { width: 768, height: 1024 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
      },
    },
  ],
});
