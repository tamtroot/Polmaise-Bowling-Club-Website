import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createStaticServer } from "./static-server.mjs";

/**
 * Stage 10: renders the footer social icons in both themes and reports what is
 * actually painted, so an invisible glyph cannot hide behind a passing test.
 *
 * Writes magnified PNGs (OUTPUT_DIR, default the temp folder) and prints the
 * computed colour, font and glyph geometry of every icon.
 */
const root = process.cwd();
const siteRoot = path.resolve(root, process.env.SITE_ROOT ?? "_site");
const outputDirectory = path.resolve(
  process.env.OUTPUT_DIR ?? path.join(process.env.TEMP ?? process.env.TMP ?? root, "polmaise-icons"),
);
const port = 4188;

const server = createStaticServer(siteRoot);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const browser = await chromium.launch();
const findings = [];

try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 3,
    });
    const page = await context.newPage();
    await page.addInitScript((value) => {
      try {
        window.localStorage.setItem("polmaise-theme", value);
      } catch (error) {
        /* storage unavailable */
      }
    }, theme);
    await page.clock.setFixedTime(new Date("2026-09-13T12:00:00Z"));
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);

    const icons = await page.evaluate(() =>
      [...document.querySelectorAll(".social-links > *")].map((link) => {
        const glyph = link.querySelector("i");
        const linkStyle = getComputedStyle(link);
        const glyphStyle = glyph ? getComputedStyle(glyph) : null;
        const glyphRect = glyph ? glyph.getBoundingClientRect() : null;
        return {
          tag: link.tagName.toLowerCase(),
          label: link.getAttribute("aria-label"),
          classes: glyph ? [...glyph.classList].join(" ") : null,
          glyphText: glyph ? glyph.textContent : null,
          linkColour: linkStyle.color,
          linkBackground: linkStyle.backgroundColor,
          glyphColour: glyphStyle ? glyphStyle.color : null,
          glyphFont: glyphStyle ? glyphStyle.fontFamily : null,
          glyphSize: glyphRect ? [Math.round(glyphRect.width), Math.round(glyphRect.height)] : null,
        };
      }),
    );

    await mkdir(outputDirectory, { recursive: true });
    const container = page.locator(".social-links");
    const file = path.join(outputDirectory, `social-icons-${theme}.png`);
    await container.screenshot({ path: file });

    findings.push({ theme, file: path.relative(root, file).split(path.sep).join("/"), icons });
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}

for (const entry of findings) {
  console.log(`\n## ${entry.theme} theme (${entry.file})`);
  for (const icon of entry.icons) {
    console.log(
      `  ${icon.tag} [${icon.label ?? "decorative"}] classes="${icon.classes}" size=${icon.glyphSize?.join("x")} glyph=${icon.glyphColour} on ${icon.linkBackground} font=${icon.glyphFont}`,
    );
  }
}
