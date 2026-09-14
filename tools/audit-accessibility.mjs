import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { SITE_PAGES } from "../tests/helpers/site-pages.mjs";
import { createStaticServer } from "./static-server.mjs";

// Stage 7 pre-work: axe detail plus a semantics/metadata audit for every page.
const require = createRequire(import.meta.url);
const axeSource = require("axe-core").source;

const root = process.cwd();
const reportRoot = path.join(root, "reports", "stage7");
const port = 4184;

const server = createStaticServer(path.join(root, process.env.SITE_ROOT ?? "_site"));
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const browser = await chromium.launch();
const pages = [];

try {
  for (const sitePage of SITE_PAGES) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date("2026-09-13T12:00:00Z"));
    await page.goto(`http://127.0.0.1:${port}${sitePage.path}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);

    const runAxe = async () => {
      await page.addScriptTag({ content: axeSource }).catch(() => {});
      return page.evaluate(async () => {
        const results = await window.axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
        });
        return results.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          nodeCount: violation.nodes.length,
          nodes: violation.nodes.slice(0, 8).map((node) => ({
            target: node.target.join(" "),
            html: node.html.slice(0, 200),
            summary: (node.failureSummary ?? "").split("\n").slice(0, 3).join(" "),
          })),
        }));
      });
    };

    const axe = await runAxe();

    // Some components (mobile fixture cards, offline badges) only render small.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    const axeMobile = await runAxe();
    await page.setViewportSize({ width: 1440, height: 900 });

    const audit = await page.evaluate(() => {
      const text = (element) => (element.textContent ?? "").replace(/\s+/g, " ").trim();
      const accessibleName = (element) => {
        const label = element.getAttribute("aria-label");
        if (label && label.trim()) {
          return label.trim();
        }
        const labelledBy = element.getAttribute("aria-labelledby");
        if (labelledBy) {
          const target = document.getElementById(labelledBy);
          if (target && text(target)) {
            return text(target);
          }
        }
        const image = element.querySelector("img[alt]");
        if (image && image.getAttribute("alt").trim()) {
          return image.getAttribute("alt").trim();
        }
        const title = element.getAttribute("title");
        if (title && title.trim()) {
          return title.trim();
        }
        return text(element);
      };

      const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].map(
        (heading) => ({
          level: Number(heading.tagName[1]),
          text: text(heading).slice(0, 90),
        }),
      );

      const meta = (selector) => document.querySelector(selector)?.getAttribute("content") ?? null;

      const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')].map(
        (script) => {
          try {
            const parsed = JSON.parse(script.textContent);
            return { valid: true, types: [].concat(parsed["@type"] ?? []) };
          } catch (error) {
            return { valid: false, error: error.message };
          }
        },
      );

      const focusable = [
        ...document.querySelectorAll(
          'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ];
      const outlineSuppressed = focusable
        .filter((element) => {
          const style = getComputedStyle(element);
          return style.outlineStyle === "none" || style.outlineWidth === "0px";
        })
        .map((element) => `${element.tagName.toLowerCase()}${element.className ? `.${[...element.classList].join(".")}` : ""}`);

      return {
        title: document.title,
        description: meta('meta[name="description"]'),
        canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
        ogTitle: meta('meta[property="og:title"]'),
        ogDescription: meta('meta[property="og:description"]'),
        ogImage: meta('meta[property="og:image"]'),
        twitterCard: meta('meta[name="twitter:card"]'),
        htmlLang: document.documentElement.getAttribute("lang"),
        landmarks: {
          main: document.querySelectorAll("main").length,
          header: document.querySelectorAll("header").length,
          nav: document.querySelectorAll("nav").length,
          footer: document.querySelectorAll("footer").length,
          aside: document.querySelectorAll("aside").length,
        },
        headingCount: headings.length,
        headings,
        h1Count: headings.filter((heading) => heading.level === 1).length,
        imagesWithoutAlt: [...document.querySelectorAll("img:not([alt])")].map(
          (image) => image.getAttribute("src"),
        ),
        linksWithoutAccessibleName: [...document.querySelectorAll("a[href]")]
          .filter((link) => accessibleName(link) === "")
          .map((link) => link.getAttribute("href")),
        iframes: [...document.querySelectorAll("iframe")].map((iframe) => ({
          src: (iframe.getAttribute("src") ?? "").slice(0, 80),
          title: iframe.getAttribute("title"),
        })),
        formControls: [...document.querySelectorAll("input, select, textarea")].map((control) => {
          const id = control.getAttribute("id");
          const label =
            (id ? document.querySelector(`label[for="${id}"]`) : null) ??
            control.closest("label");
          return {
            tag: control.tagName.toLowerCase(),
            type: control.getAttribute("type"),
            id,
            name: control.getAttribute("name"),
            hasLabel: Boolean(label) || Boolean(control.getAttribute("aria-label")) || Boolean(control.getAttribute("aria-labelledby")),
            describedBy: control.getAttribute("aria-describedby"),
            ariaInvalid: control.getAttribute("aria-invalid"),
          };
        }),
        liveRegions: [...document.querySelectorAll('[aria-live], [role="alert"], [role="status"]')].map(
          (element) => `${element.tagName.toLowerCase()}#${element.id || "-"}`,
        ),
        jsonLd,
        focusableCount: focusable.length,
        focusOutlineSuppressedCount: outlineSuppressed.length,
        focusOutlineSuppressedSample: [...new Set(outlineSuppressed)].slice(0, 12),
        placeholderLinks: [...document.querySelectorAll('a[href="#"]')].length,
        tabindexPositive: [...document.querySelectorAll('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])')].length,
        clickHandlersOnNonInteractive: [...document.querySelectorAll("div[onclick], span[onclick]")].length,
      };
    });

    pages.push({
      name: sitePage.name,
      label: sitePage.label,
      path: sitePage.path,
      axe,
      axeMobile,
      ...audit,
    });
    console.log(
      `${sitePage.path}: axe desktop ${axe.reduce((total, violation) => total + violation.nodeCount, 0)} / mobile ${axeMobile.reduce((total, violation) => total + violation.nodeCount, 0)}, h1=${audit.h1Count}, main=${audit.landmarks.main}, description=${audit.description ? "yes" : "NO"}, canonical=${audit.canonical ? "yes" : "NO"}`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}

const totals = {
  violationInstances: pages.reduce(
    (total, page) => total + page.axe.reduce((sum, violation) => sum + violation.nodeCount, 0),
    0,
  ),
  mobileViolationInstances: pages.reduce(
    (total, page) =>
      total + page.axeMobile.reduce((sum, violation) => sum + violation.nodeCount, 0),
    0,
  ),
  rules: pages.reduce((total, page) => total + page.axe.length, 0),
  byRule: Object.fromEntries(
    [
      ...new Set(
        pages.flatMap((page) => [
          ...page.axe.map((violation) => violation.id),
          ...page.axeMobile.map((violation) => violation.id),
        ]),
      ),
    ]
      .sort()
      .map((ruleId) => {
        const matching = pages.flatMap((page) =>
          [...page.axe, ...page.axeMobile]
            .filter((violation) => violation.id === ruleId)
            .map((violation) => ({ page, violation })),
        );
        return [
          ruleId,
          {
            impact: matching[0].violation.impact,
            instances: matching.reduce((total, item) => total + item.violation.nodeCount, 0),
            pages: matching.map((item) => item.page.path),
          },
        ];
      }),
  ),
  pagesMissingDescription: pages.filter((page) => !page.description).map((page) => page.path),
  pagesMissingCanonical: pages.filter((page) => !page.canonical).map((page) => page.path),
  pagesMissingMain: pages.filter((page) => page.landmarks.main === 0).map((page) => page.path),
  pagesWithoutH1: pages.filter((page) => page.h1Count === 0).map((page) => page.path),
  pagesWithMultipleH1: pages.filter((page) => page.h1Count > 1).map((page) => page.path),
  duplicateTitles: Object.entries(
    pages.reduce((counts, page) => {
      counts[page.title] = (counts[page.title] ?? 0) + 1;
      return counts;
    }, {}),
  )
    .filter(([, count]) => count > 1)
    .map(([title]) => title),
};

await mkdir(reportRoot, { recursive: true });
await writeFile(
  path.join(reportRoot, "accessibility-audit.json"),
  `${JSON.stringify({ totals, pages }, null, 2)}\n`,
  "utf8",
);

const lines = [
  "# Stage 7 accessibility and SEO audit",
  "",
  `- axe violation instances: ${totals.violationInstances} across ${totals.rules} rule/page combinations`,
  `- pages missing meta description: ${totals.pagesMissingDescription.length}`,
  `- pages missing canonical: ${totals.pagesMissingCanonical.length}`,
  `- pages missing <main>: ${totals.pagesMissingMain.length}`,
  `- pages without an h1: ${totals.pagesWithoutH1.length}`,
  `- pages with multiple h1: ${totals.pagesWithMultipleH1.length}`,
  `- duplicate titles: ${totals.duplicateTitles.length}`,
  "",
  "## axe violations by rule",
  "",
  "| Rule | Impact | Instances | Pages |",
  "| --- | --- | --- | --- |",
  ...Object.entries(totals.byRule).map(
    ([ruleId, value]) =>
      `| ${ruleId} | ${value.impact} | ${value.instances} | ${value.pages.length} |`,
  ),
  "",
  "## Per page",
  "",
  "| Page | axe rules | instances | h1 | main | description | canonical | OG |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ...pages.map(
    (page) =>
      `| ${page.path} | ${page.axe.length} | ${page.axe.reduce((total, violation) => total + violation.nodeCount, 0)} | ${page.h1Count} | ${page.landmarks.main} | ${page.description ? "yes" : "NO"} | ${page.canonical ? "yes" : "NO"} | ${page.ogTitle ? "yes" : "NO"} |`,
  ),
  "",
  "## Heading outlines",
  "",
  ...pages.flatMap((page) => [
    `### ${page.path}`,
    "",
    ...page.headings.slice(0, 24).map((heading) => `${"  ".repeat(heading.level - 1)}- h${heading.level}: ${heading.text}`),
    "",
  ]),
  "",
];

await writeFile(path.join(reportRoot, "accessibility-audit.md"), `${lines.join("\n")}\n`, "utf8");

console.log("\n" + lines.slice(0, 12).join("\n"));
console.log("\nWrote reports/stage7/accessibility-audit.json and .md");
