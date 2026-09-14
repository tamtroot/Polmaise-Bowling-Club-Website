import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { SITE_PAGES } from "../tests/helpers/site-pages.mjs";
import { createStaticServer } from "./static-server.mjs";

const label = process.argv[2] ?? "before";
const root = process.cwd();
const siteRoot = path.resolve(root, "_site");
const port = 4180;
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

const server = createStaticServer(siteRoot);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const browser = await chromium.launch();
const results = {
  label,
  capturedAt: new Date().toISOString(),
  pages: [],
};

try {
  for (const sitePage of SITE_PAGES) {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date("2026-09-13T12:00:00Z"));
      await page.goto(`http://127.0.0.1:${port}${sitePage.path}`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);

      const capture = await page.evaluate(() => {
        const round = (value) => Math.round(value * 100) / 100;
        const describe = (element) => {
          const classes = [...element.classList].sort().join(".");
          const id = element.id ? `#${element.id}` : "";
          return `${element.tagName.toLowerCase()}${id}${classes ? `.${classes}` : ""}`;
        };

        const elements = [];
        const images = [];
        for (const element of document.body.querySelectorAll("*")) {
          const rect = element.getBoundingClientRect();
          elements.push(
            `${describe(element)}|${round(rect.x)},${round(rect.y)},${round(rect.width)},${round(rect.height)}`,
          );
          if (element.tagName === "IMG") {
            images.push({
              src: element.getAttribute("src"),
              currentSrc: element.currentSrc,
              displayed: [round(rect.width), round(rect.height)],
              natural: [element.naturalWidth, element.naturalHeight],
              complete: element.complete,
            });
          }
        }

        return {
          elements,
          images,
          textHash: [...document.body.innerText].reduce(
            (hash, character) => (hash * 31 + character.charCodeAt(0)) % 2147483647,
            7,
          ),
          scrollHeight: document.documentElement.scrollHeight,
        };
      });

      results.pages.push({
        path: sitePage.path,
        label: sitePage.label,
        viewport: viewport.name,
        elementCount: capture.elements.length,
        elementsHash: createHash("sha256")
          .update(capture.elements.join("\n"))
          .digest("hex"),
        elements: capture.elements,
        images: capture.images,
        textHash: capture.textHash,
        scrollHeight: capture.scrollHeight,
      });

      await context.close();
      console.log(`captured ${sitePage.path} @ ${viewport.name}`);
    }
  }
} finally {
  await browser.close();
  server.close();
}

await mkdir(path.join(root, "reports", "latest"), { recursive: true });
await writeFile(
  path.join(root, "reports", "latest", `layout-${label}.json`),
  `${JSON.stringify(results, null, 2)}\n`,
  "utf8",
);

console.log(`Wrote reports/latest/layout-${label}.json`);
