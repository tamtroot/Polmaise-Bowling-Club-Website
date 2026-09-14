import path from "node:path";
import { chromium } from "playwright";
import { SITE_PAGES } from "../tests/helpers/site-pages.mjs";
import { createStaticServer } from "./static-server.mjs";

/**
 * Stage 9 component review: header layout at every breakpoint boundary.
 *
 * Reports any overlap between the club logo, the desktop navigation, the
 * theme toggle and the mobile menu button, plus horizontal page overflow.
 */
const root = process.cwd();
const siteRoot = path.resolve(root, process.env.SITE_ROOT ?? "_site");
const port = 4187;
const widths = (process.env.WIDTHS ?? "1440,1366,1280,1200,1100,1024,993,992,768,480,390")
  .split(",")
  .map((value) => Number(value.trim()));
const themes = ["light", "dark"];
const pageFilter = (process.env.PAGES ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const pages = pageFilter.length
  ? SITE_PAGES.filter((sitePage) => pageFilter.includes(sitePage.name))
  : SITE_PAGES;

const server = createStaticServer(siteRoot);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const browser = await chromium.launch();
const problems = [];
const lastResults = [];
let checks = 0;

try {
  for (const sitePage of pages) {
    for (const width of widths) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        deviceScaleFactor: 1,
      });
      for (const theme of themes) {
        const page = await context.newPage();
        await page.addInitScript((value) => {
          try {
            window.localStorage.setItem("polmaise-theme", value);
          } catch (error) {
            /* storage unavailable */
          }
        }, theme);
        await page.clock.setFixedTime(new Date("2026-09-13T12:00:00Z"));
        await page.goto(`http://127.0.0.1:${port}${sitePage.path}`, {
          waitUntil: "domcontentloaded",
        });
        await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(150);

        const result = await page.evaluate(() => {
          const box = (selector) => {
            const element = document.querySelector(selector);
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            if (
              rect.width === 0 ||
              rect.height === 0 ||
              style.display === "none" ||
              style.visibility === "hidden"
            ) {
              return null;
            }
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
          };
          const overlaps = (a, b) =>
            a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;

          const logo = box(".logo");
          const nav = box("nav ul");
          const toggle = box("[data-theme-toggle]");
          const mobile = box(".mobile-menu");

          return {
            logo,
            nav,
            toggle,
            mobile,
            wordmark: (() => {
              const heading = document.querySelector(".logo-text h1");
              if (!heading) return null;
              const style = getComputedStyle(heading);
              const rect = heading.getBoundingClientRect();
              return {
                fontFamily: style.fontFamily,
                fontSize: style.fontSize,
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                lines: Math.round(rect.height / Number.parseFloat(style.lineHeight)),
              };
            })(),
            logoNavOverlap: overlaps(logo, nav),
            navToggleOverlap: overlaps(nav, toggle),
            logoMobileOverlap: overlaps(logo, mobile),
            navOverflowsViewport: nav ? nav.right > window.innerWidth - 1 : false,
            horizontalOverflow: Math.max(
              0,
              document.documentElement.scrollWidth - window.innerWidth,
            ),
            navVisible: Boolean(nav),
            mobileVisible: Boolean(mobile),
          };
        });

        checks += 1;
        lastResults.push({ page: sitePage.path, width, theme, ...result });
        if (
          result.logoNavOverlap ||
          result.navToggleOverlap ||
          result.logoMobileOverlap ||
          result.navOverflowsViewport ||
          result.horizontalOverflow > 1
        ) {
          problems.push({
            page: sitePage.path,
            width,
            theme,
            ...result,
          });
        }
        await page.close();
      }
      await context.close();
    }
    console.log(`checked ${sitePage.path}`);
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${checks} header checks, ${problems.length} problems`);
for (const problem of problems.slice(0, 40)) {
  console.log(
    `${problem.page} @${problem.width} (${problem.theme}): logo/nav=${problem.logoNavOverlap} nav/toggle=${problem.navToggleOverlap} logo/mobile=${problem.logoMobileOverlap} navBeyondViewport=${problem.navOverflowsViewport} hOverflow=${problem.horizontalOverflow} logo=${JSON.stringify(problem.logo)} nav=${JSON.stringify(problem.nav)} wordmark=${JSON.stringify(problem.wordmark)}`,
  );
}

if (process.argv.includes("--verbose")) {
  console.log("\nWordmark metrics:");
  const seen = new Set();
  for (const entry of lastResults) {
    const key = `${entry.width}/${entry.theme}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(
      `  @${entry.width} (${entry.theme}): ${entry.wordmark?.fontSize} ${entry.wordmark?.fontFamily} width=${entry.wordmark?.width}px lines=${entry.wordmark?.lines} logoRight=${Math.round(entry.logo?.right ?? 0)} navLeft=${Math.round(entry.nav?.left ?? 0)}`,
    );
  }
}
