import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { SITE_PAGES } from "../tests/helpers/site-pages.mjs";
import { createStaticServer } from "./static-server.mjs";

/**
 * Stage 9 visual review capture.
 *
 * Screenshots every public page in the day theme at desktop/tablet/mobile and
 * the night theme at the same viewports, and records the checks that are hard
 * to eyeball in 100+ images: dark-mode "white islands", legacy gold/green
 * fragments, horizontal overflow, broken images and console/page errors.
 *
 * PNGs are written outside the repository (OUTPUT_DIR) so the baseline archive
 * stays small; the JSON findings are written to reports/stage9/.
 */
const root = process.cwd();
const siteRoot = path.resolve(root, process.env.SITE_ROOT ?? "_site");
const outputDirectory = path.resolve(
  process.env.OUTPUT_DIR ?? path.join(process.env.TEMP ?? process.env.TMP ?? root, "polmaise-stage9-visuals"),
);
const port = 4186;
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];
// The brief requires an in-depth night review of at least these pages.
const deepNightReview = new Set([
  "home",
  "fixtures",
  "news",
  "gallery",
  "history",
  "membership",
  "signup",
  "sponsors",
  "archive",
  "album-presentation-dance-2025",
]);

const server = createStaticServer(siteRoot);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

// Optional filter, e.g. PAGES=home,fixtures for a quick iteration pass.
const pageFilter = (process.env.PAGES ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const pages = pageFilter.length
  ? SITE_PAGES.filter((sitePage) => pageFilter.includes(sitePage.name))
  : SITE_PAGES;

const browser = await chromium.launch();
const report = {
  generatedAt: new Date().toISOString(),
  siteRoot,
  outputDirectory,
  captures: [],
  findings: {
    whiteIslands: [],
    legacyHues: [],
    horizontalOverflow: [],
    brokenImages: [],
    consoleErrors: [],
    pageErrors: [],
    invisibleControls: [],
  },
};

const evaluatePage = (page) =>
  page.evaluate(() => {
    // Stage 10: the design system deliberately includes brass, status and
    // solid-button colours. They are brand decisions, not leftovers, so the
    // heuristics below report them separately instead of as defects.
    const ACCEPTED_ACCENTS = new Set([
      "rgb(232, 200, 138)", // brass (night footer headings)
      "rgb(211, 177, 115)", // brass (night wordmark rule)
      "rgb(138, 106, 47)", // brass (day)
      "rgb(134, 220, 166)", // positive text
      "rgb(22, 48, 31)", // positive surface
      "rgb(242, 200, 121)", // warning text
      "rgb(51, 38, 15)", // warning surface
      "rgb(107, 84, 51)", // heritage border
      "rgb(36, 28, 18)", // heritage surface
      "rgb(42, 36, 18)", // notice surface
    ]);
    const isSolidControl = (element) =>
      element.matches(
        ".btn, .cta-button, input[type='submit'], button:not(.accordion-header):not(.mobile-menu):not([data-theme-toggle])",
      );

    const parseColour = (value) => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1].split(",").map((part) => Number.parseFloat(part));
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    };
    const luminance = ({ r, g, b }) => {
      const channel = (value) => {
        const scaled = value / 255;
        return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const describe = (element) => {
      const classes = [...element.classList].slice(0, 3).join(".");
      const id = element.id ? `#${element.id}` : "";
      return `${element.tagName.toLowerCase()}${id}${classes ? `.${classes}` : ""}`;
    };
    const hueOf = ({ r, g, b }) => {
      const red = r / 255;
      const green = g / 255;
      const blue = b / 255;
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const delta = max - min;
      if (delta === 0) return { hue: 0, saturation: 0 };
      let hue;
      if (max === red) hue = ((green - blue) / delta) % 6;
      else if (max === green) hue = (blue - red) / delta + 2;
      else hue = (red - green) / delta + 4;
      hue *= 60;
      if (hue < 0) hue += 360;
      return { hue, saturation: max === 0 ? 0 : delta / max };
    };

    const results = {
      whiteIslands: [],
      legacyHues: [],
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      brokenImages: [],
      invisibleControls: [],
    };

    const isImageLike = (element) =>
      ["IMG", "SVG", "CANVAS", "VIDEO", "IFRAME", "PICTURE"].includes(element.tagName);

    for (const element of document.body.querySelectorAll("*")) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const area = rect.width * rect.height;

      if (area > 3000 && !isImageLike(element) && !isSolidControl(element)) {
        const background = parseColour(style.backgroundColor);
        if (background && background.a >= 0.6 && style.backgroundImage === "none") {
          const colour = luminance(background);
          if (colour > 0.55) {
            results.whiteIslands.push({
              element: describe(element),
              colour: style.backgroundColor,
              area: Math.round(area),
            });
          }
        }
      }

      if (area > 800) {
        for (const [property, value] of [
          ["color", style.color],
          ["background-color", style.backgroundColor],
          ["border-top-color", style.borderTopColor],
        ]) {
          const colour = parseColour(value);
          if (!colour || colour.a < 0.5) continue;
          const { hue, saturation } = hueOf(colour);
          if (saturation < 0.35) continue;
          if (ACCEPTED_ACCENTS.has(value.replace(/\s+/g, " "))) continue;
          // Gold/amber and green are the retired club colours.
          const isGold = hue >= 33 && hue <= 62;
          const isGreen = hue >= 85 && hue <= 165;
          if (isGold || isGreen) {
            results.legacyHues.push({
              element: describe(element),
              property,
              value,
              hue: Math.round(hue),
              area: Math.round(area),
            });
          }
        }
      }

      if (element.tagName === "IMG") {
        if (element.complete && element.naturalWidth === 0 && rect.width > 0) {
          results.brokenImages.push(element.getAttribute("src"));
        }
      }

      if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(element.tagName)) {
        if (rect.width === 0 || rect.height === 0) {
          results.invisibleControls.push(`${describe(element)} (${rect.width}x${rect.height})`);
        }
      }
    }

    return results;
  });

try {
  for (const sitePage of pages) {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
      });

      for (const theme of ["day", "night"]) {
        if (theme === "night" && !deepNightReview.has(sitePage.name) && viewport.name !== "desktop") {
          continue;
        }
        const page = await context.newPage();
        const consoleErrors = [];
        const pageErrors = [];
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text());
        });
        page.on("pageerror", (error) => pageErrors.push(error.message));

        if (theme === "night") {
          await page.addInitScript(() => {
            try {
              window.localStorage.setItem("polmaise-theme", "dark");
            } catch (error) {
              /* storage unavailable */
            }
          });
        }

        await page.clock.setFixedTime(new Date("2026-09-13T12:00:00Z"));
        await page.goto(`http://127.0.0.1:${port}${sitePage.path}`, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
        await page.evaluate(() => document.fonts.ready);
        // Full-page captures happen before below-the-fold lazy images finish,
        // which made strips at the end of a page look empty in reviews.
        await page.evaluate(async () => {
          // Walk the page so lazy images enter the viewport, then force the
          // remainder and wait for every decode.
          const step = Math.round(window.innerHeight * 0.8);
          for (let y = 0; y < document.body.scrollHeight; y += step) {
            window.scrollTo(0, y);
            await new Promise((resolve) => requestAnimationFrame(() => resolve()));
          }
          window.scrollTo(0, 0);
          const images = [...document.images];
          for (const image of images) image.loading = "eager";
          await Promise.all(
            images
              .filter((image) => !image.complete)
              .map((image) => image.decode().catch(() => {})),
          );
          await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        });
        await page.waitForTimeout(400);

        const directory = path.join(outputDirectory, theme);
        await mkdir(directory, { recursive: true });
        const file = path.join(directory, `${sitePage.name}-${viewport.name}.png`);
        await page.screenshot({ path: file, fullPage: true });

        const diagnostics = await evaluatePage(page);
        const appliedTheme = await page.evaluate(() =>
          document.documentElement.getAttribute("data-theme"),
        );

        report.captures.push({
          page: sitePage.name,
          path: sitePage.path,
          viewport: viewport.name,
          theme,
          appliedTheme,
          file: path.relative(root, file).split(path.sep).join("/"),
          ...diagnostics,
          consoleErrors,
          pageErrors,
        });

        if (diagnostics.whiteIslands.length) {
          report.findings.whiteIslands.push(
            ...diagnostics.whiteIslands.map((item) => ({
              page: sitePage.path,
              viewport: viewport.name,
              theme,
              ...item,
            })),
          );
        }
        if (diagnostics.legacyHues.length) {
          report.findings.legacyHues.push(
            ...diagnostics.legacyHues.map((item) => ({
              page: sitePage.path,
              viewport: viewport.name,
              theme,
              ...item,
            })),
          );
        }
        if (diagnostics.horizontalOverflow > 1) {
          report.findings.horizontalOverflow.push({
            page: sitePage.path,
            viewport: viewport.name,
            theme,
            overflow: Math.round(diagnostics.horizontalOverflow),
          });
        }
        if (diagnostics.brokenImages.length) {
          report.findings.brokenImages.push({
            page: sitePage.path,
            viewport: viewport.name,
            theme,
            images: diagnostics.brokenImages.slice(0, 5),
          });
        }
        if (consoleErrors.length) {
          report.findings.consoleErrors.push({
            page: sitePage.path,
            viewport: viewport.name,
            theme,
            messages: consoleErrors.slice(0, 5),
          });
        }
        if (pageErrors.length) {
          report.findings.pageErrors.push({
            page: sitePage.path,
            viewport: viewport.name,
            theme,
            messages: pageErrors.slice(0, 5),
          });
        }
        if (diagnostics.invisibleControls.length) {
          report.findings.invisibleControls.push({
            page: sitePage.path,
            viewport: viewport.name,
            theme,
            controls: diagnostics.invisibleControls.slice(0, 8),
          });
        }

        console.log(`captured ${sitePage.path} @ ${viewport.name} (${theme})`);
        await page.close();
      }

      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

const reportRoot = path.join(root, "reports", "stage9");
await mkdir(reportRoot, { recursive: true });
await writeFile(
  path.join(reportRoot, "visual-review.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);

console.log(`\nCaptures: ${report.captures.length}`);
console.log(
  JSON.stringify(
    {
      whiteIslands: report.findings.whiteIslands.length,
      legacyHues: report.findings.legacyHues.length,
      horizontalOverflow: report.findings.horizontalOverflow.length,
      brokenImages: report.findings.brokenImages.length,
      consoleErrors: report.findings.consoleErrors.length,
      pageErrors: report.findings.pageErrors.length,
      invisibleControls: report.findings.invisibleControls.length,
    },
    null,
    2,
  ),
);
console.log(`Wrote reports/stage9/visual-review.json and screenshots to ${outputDirectory}`);
