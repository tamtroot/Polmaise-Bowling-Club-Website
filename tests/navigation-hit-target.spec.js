import { expect, test } from "@playwright/test";

/**
 * Stage 11: the desktop header navigation must not move under the user's
 * cursor, and a click aimed at a navigation label must navigate.
 *
 * Root cause these tests pin down: the right-aligned desktop navigation has no
 * reserved widths, so when the web font replaces the fallback font shortly
 * after first paint every item re-flows (measured: 21-23px at 1440px). Adjacent
 * items are separated by a 4px gap, so a click aimed at the label the user can
 * actually see can land in that gap (nothing happens at all) or on the
 * neighbouring item (the wrong page loads). Both tests below fail on the
 * pre-fix implementation.
 */

// Delay the font *files* (not the stylesheet: that would also hold up
// DOMContentLoaded). This reproduces a cold load, where the page paints with
// fallback metrics and re-flows when the real font arrives.
const FONT_FILES = /\.woff2$/;

const delayFonts = (page, delay) =>
  page.route(FONT_FILES, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delay));
    await route.continue();
  });

const navGeometry = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("header nav ul li a")].map((anchor) => {
      const rect = anchor.getBoundingClientRect();
      return {
        text: anchor.textContent.trim(),
        href: anchor.getAttribute("href"),
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    }),
  );

const linkNamed = (geometry, name) => geometry.find((entry) => entry.text === name);

/**
 * The boxes that can move the right-aligned navigation: every one of them must
 * keep its width across the web font swap, otherwise the whole row shifts and
 * the per-label measurements below would blame the labels for it.
 */
const headerBoxes = (page) =>
  page.evaluate(() => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return [Number(rect.left.toFixed(2)), Number(rect.width.toFixed(2))];
    };
    return {
      container: box("body > header .container"),
      logo: box("body > header .logo"),
      wordmark: box("body > header .logo-text h1"),
      nav: box("body > header nav"),
      list: box("body > header nav ul"),
      toggle: box("[data-theme-toggle]"),
    };
  });

/**
 * `unicode-range` coverage, enough for the grammar the font pipeline emits
 * (`U+20`, `U+45-48`). Used to prove the inlined navigation subset carries
 * every character the header labels can paint.
 */
const unicodeRangeCovers = (range, codePoint) => {
  for (const part of range.split(",")) {
    const match = /^\s*U\+([0-9a-f]{1,6})(?:-([0-9a-f]{1,6}))?\s*$/i.exec(part);
    if (!match) continue;
    const start = Number.parseInt(match[1], 16);
    const end = match[2] ? Number.parseInt(match[2], 16) : start;
    if (codePoint >= start && codePoint <= end) return true;
  }
  return false;
};

/** Waits until an element's box stops changing (e.g. after a drawer slides in). */
const waitForStableBox = async (page, selector, timeout = 3_000) => {
  const deadline = Date.now() + timeout;
  let previous = null;
  while (Date.now() < deadline) {
    const current = await page.evaluate((value) => {
      const element = document.querySelector(value);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return [rect.left, rect.top, rect.width, rect.height];
    }, selector);
    if (
      previous &&
      current &&
      previous.every((value, index) => Math.abs(value - current[index]) < 0.5)
    ) {
      return;
    }
    previous = current;
    await page.waitForTimeout(50);
  }
};

test.describe("desktop navigation hit targets", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1280, "Inline navigation needs 1280px+");

  /*
   * The gap between navigation items is 4px, so a residual under 3px cannot
   * move a realistically aimed click onto a neighbour or into the gap. The
   * metric-matched fallback takes the worst case from 32.94px to ~1.4px on
   * Windows (Segoe UI) and ~2.7px on Arial-only platforms; the click test
   * below verifies the behaviour directly at nine points across the label.
   */
  const MATERIAL_MOVEMENT_PX = 3;

  /**
   * The calibrated fallback families declared in `styles.css`, in stack order.
   * Every platform must resolve at least one of them, otherwise the navigation
   * paints with an uncalibrated system font and drifts when the web font
   * arrives — which is exactly what happened on the Linux CI runner, where the
   * Windows-only faces resolved to nothing.
   */
  const FALLBACK_FAMILIES = [
    "Open Sans Fallback Arial",
    "Open Sans Fallback Segoe",
    "Open Sans Fallback Tahoma",
    "Open Sans Fallback Liberation",
  ];

  test("a calibrated fallback face is available on this platform", async ({ page }) => {
    await page.goto("/fixtures.html", { waitUntil: "domcontentloaded" });

    const library = await page.evaluate(() => {
      const sheets = [...document.styleSheets].flatMap((sheet) => {
        try {
          return [...sheet.cssRules].map((rule) => rule.cssText);
        } catch (error) {
          return [];
        }
      });
      return sheets.join("\n");
    });

    // The faces themselves: one per platform font, each with its own measured
    // calibration (a shared family name would let the cascade drop them again).
    for (const family of FALLBACK_FAMILIES) {
      const declaration = new RegExp(
        `@font-face\\s*\\{[^}]*font-family:\\s*"${family}"[^}]*\\}`,
        "i",
      ).exec(library.replace(/\s+/g, " "));
      expect(declaration, `${family} is not declared in styles.css`).not.toBeNull();
      expect(declaration[0], `${family} has no size-adjust`).toMatch(/size-adjust:\s*1[01]\d(?:\.\d+)?%/);
      expect(declaration[0], `${family} has no ascent-override`).toMatch(/ascent-override:\s*[\d.]+%/);
      expect(declaration[0], `${family} has no descent-override`).toMatch(/descent-override:\s*[\d.]+%/);
    }

    // ...and they must be reached before any generic family.
    const uiStack = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--font-ui"),
    );
    const positions = FALLBACK_FAMILIES.map((family) => uiStack.indexOf(family));
    const generic = ["system-ui", "sans-serif"]
      .map((family) => uiStack.indexOf(family))
      .filter((index) => index >= 0);
    expect(positions.filter((index) => index >= 0).length).toBeGreaterThan(0);
    expect(Math.max(...positions.filter((index) => index >= 0))).toBeLessThan(Math.min(...generic));

    // At least one calibrated face must actually resolve on this platform.
    const resolved = await page.evaluate((families) => {
      const size = getComputedStyle(document.querySelector("header nav ul li a")).fontSize;
      return families.filter((family) => document.fonts.check(`${size} "${family}"`));
    }, FALLBACK_FAMILIES);
    expect(
      resolved,
      `no calibrated fallback font is installed (tried: ${FALLBACK_FAMILIES.join(", ")}); ` +
        "the navigation would paint with an uncalibrated system font",
    ).not.toEqual([]);

    console.log(`[nav-guard] calibrated fallback in effect: ${resolved.join(", ")}`);
  });

  test("the navigation paints with the inlined Open Sans subset", async ({ page }) => {
    /*
     * The per-platform calibrations above can only ever approximate Open Sans:
     * the CI movements for the Linux runner imply corrections between -1.7%
     * and +4.1% for individual labels, so no single `size-adjust` holds the row
     * still there. The navigation therefore paints with a subset of the very
     * Open Sans instance it settles in, inlined as a data URI so it is available
     * before the first layout on every platform (a separate file would race the
     * web font it stands in for).
     *
     * These assertions fail on *every* platform if that face is removed,
     * mis-declared, or stops covering a label, so the portability of the
     * navigation no longer depends on which fonts a runner happens to have.
     */
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/fixtures.html", { waitUntil: "domcontentloaded" });

    const declarations = await page.evaluate(() =>
      [...document.styleSheets].flatMap((sheet) => {
        try {
          return [...sheet.cssRules].map((rule) => rule.cssText);
        } catch (error) {
          return [];
        }
      }),
    );
    const declaration = declarations.find((text) => /font-family:\s*"Open Sans Nav"/.test(text));
    expect(declaration, "'Open Sans Nav' is not declared in the stylesheets").toBeTruthy();
    expect(declaration, "the navigation subset is not inlined").toMatch(
      /src:\s*url\("?data:font\/woff2;base64,[A-Za-z0-9+/=]+"?\)/,
    );
    const unicodeRange = /unicode-range:\s*([^;]+);/.exec(declaration)?.[1] ?? "";
    expect(unicodeRange, "the navigation subset declares no unicode-range").not.toBe("");

    // It must be reached before the platform-specific faces.
    const stack = await page.evaluate(
      () => getComputedStyle(document.querySelector("header nav ul li a")).fontFamily,
    );
    expect(stack).toContain("Open Sans Nav");
    expect(stack.indexOf("Open Sans Nav")).toBeLessThan(
      stack.indexOf("Open Sans Fallback"),
    );

    // ...and it must carry every character the labels can paint.
    const labelCharacters = await page.evaluate(() =>
      [
        ...new Set(
          [...document.querySelectorAll("header nav ul li a")].flatMap((anchor) => [
            ...anchor.textContent,
          ]),
        ),
      ].sort(),
    );
    const uncovered = labelCharacters.filter(
      (character) => !unicodeRangeCovers(unicodeRange, character.codePointAt(0)),
    );
    expect(
      uncovered,
      `the inlined navigation subset does not cover: ${uncovered.join(" ")}`,
    ).toEqual([]);

    // The point of the subset: the first paint *is* the settled metrics.
    await page.unroute(FONT_FILES).catch(() => {});
    await delayFonts(page, 1_500);
    await page.goto("/fixtures.html", { waitUntil: "domcontentloaded" });
    const firstPaint = await navGeometry(page);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    const settled = await navGeometry(page);

    const widest = settled.reduce((result, entry) => {
      const painted = linkNamed(firstPaint, entry.text);
      return Math.max(result, painted ? Math.abs(painted.width - entry.width) : Infinity);
    }, 0);
    console.log(
      `[nav-guard] inlined subset covers ${labelCharacters.length} label characters ` +
        `(${unicodeRange}); first paint vs settled worst width ${widest.toFixed(2)}px`,
    );
    // Held to the guard's own contract rather than a tighter number: the subset
    // is the same face, so anything measurable here would mean the subset and the
    // web font are not the same instance.
    expect(
      widest,
      `the navigation's first paint differs from the metrics it settles in by ${widest}px`,
    ).toBeLessThan(MATERIAL_MOVEMENT_PX);
  });

  test("the wordmark box does not change when the serif fallback swaps", async ({ page }) => {
    /*
     * The navigation sits beside the logo and is right-aligned, so a logo that
     * changes width moves every navigation item by the same amount. On the Linux
     * runner `Times New Roman` resolves to the narrower Liberation Serif, which
     * shrank the wordmark box by ~7px and produced the 6px "common" shift in the
     * CI report; the desktop rule pins the box to the width it already renders
     * at. This measures the box, not just the final geometry, so the cause is
     * named directly if it regresses.
     */
    await page.setViewportSize({ width: 1440, height: 900 });
    await delayFonts(page, 1_500);
    await page.goto("/fixtures.html", { waitUntil: "domcontentloaded" });

    const widthOf = () =>
      page.evaluate(() => {
        const logo = document.querySelector("body > header .logo");
        const wordmark = document.querySelector("body > header .logo-text h1");
        return {
          logo: Number(logo.getBoundingClientRect().width.toFixed(2)),
          wordmark: Number(wordmark.getBoundingClientRect().width.toFixed(2)),
        };
      });

    const before = await widthOf();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    const after = await widthOf();

    // A narrow serif fallback is the failure mode: simulate one and re-measure.
    await page.addStyleTag({
      content:
        "@font-face{font-family:'Narrow Serif Probe';src:local('Times New Roman');size-adjust:100%;}" +
        "body > header .logo-text h1{font-family:'Narrow Serif Probe',serif !important;}",
    });
    await page.waitForTimeout(150);
    const withNarrowSerif = await widthOf();

    console.log(
      `[nav-guard] wordmark box ${before.wordmark} → ${after.wordmark} (webfont), ` +
        `${withNarrowSerif.wordmark} with a narrow serif fallback; logo ${before.logo} → ${withNarrowSerif.logo}`,
    );
    expect(Math.abs(after.wordmark - before.wordmark)).toBeLessThan(1);
    expect(Math.abs(withNarrowSerif.wordmark - before.wordmark)).toBeLessThan(1);
    expect(Math.abs(withNarrowSerif.logo - before.logo)).toBeLessThan(1);
  });

  test("navigation hit targets hold their position across the web font swap", async ({ page }) => {
    // Light theme first (the default), then dark for every width.
    for (const theme of ["light", "dark"]) {
      if (theme === "dark") {
        await page.addInitScript(() => {
          try {
            window.localStorage.setItem("polmaise-theme", "dark");
          } catch (error) {
            /* storage unavailable */
          }
        });
      }
      for (const width of [1440, 1280, 1024]) {
        await test.step(`${theme} @ ${width}px`, async () => {
          await page.unroute(FONT_FILES).catch(() => {});
          await delayFonts(page, 1_500);
          await page.setViewportSize({ width, height: 900 });
          await page.goto("/fixtures.html", { waitUntil: "domcontentloaded" });

          const usesDrawer = width < 1280;
          if (usesDrawer) {
            await page.locator(".mobile-menu").click();
            await expect(page.locator("nav ul")).toHaveClass(/show/);
            // The drawer slides in over 300ms; measure only once it has settled.
            await waitForStableBox(page, "nav ul");
          }
          await expect(page.locator("html")).toHaveAttribute(
            "data-theme",
            theme === "dark" ? "dark" : "light",
          );

          const before = await navGeometry(page);
          const boxesBefore = await headerBoxes(page);
          expect(
            before.length,
            `no navigation links found at ${width}px`,
          ).toBeGreaterThan(5);
          expect(
            before.every((entry) => entry.width > 0 && entry.height > 0),
            `${theme} @ ${width}px: some navigation links had no layout before the font arrived: ` +
              JSON.stringify(before),
          ).toBe(true);

          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(250);
          const after = await navGeometry(page);
          const boxesAfter = await headerBoxes(page);

          const movements = after.map((entry) => {
            const previous = linkNamed(before, entry.text);
            return {
              text: entry.text,
              fallbackWidth: previous ? Math.round(previous.width * 100) / 100 : null,
              webFontWidth: Math.round(entry.width * 100) / 100,
              ratio:
                previous && previous.width > 0
                  ? Math.round((previous.width / entry.width) * 10000) / 100
                  : null,
              shift: previous ? Math.round((entry.left - previous.left) * 100) / 100 : null,
            };
          });
          const worst = movements.reduce(
            (result, entry) => Math.max(result, Math.abs(entry.shift ?? 0)),
            0,
          );
          const news = after.find((entry) => entry.text === "News & Events");
          const fixtures = after.find((entry) => entry.text === "Fixtures");
          console.log(
            `[nav-guard] ${theme} @ ${width}px: worst movement ${worst.toFixed(2)}px` +
              ` (fallback→webfont), settled Fixtures/News left edges ` +
              `${fixtures ? fixtures.left.toFixed(2) : "n/a"}/${news ? news.left.toFixed(2) : "n/a"}`,
          );
          /*
           * Retained diagnostics: on a failing run these name the fallback, its
           * per-label widths against Open Sans, and the ratio each label
           * achieves, which is what a platform-specific calibration has to be
           * derived from. The thresholds below are unchanged.
           */
          console.log(
            `[nav-guard] ${theme} @ ${width}px per label ` +
              `(fallback width → webfont width, ratio):`,
          );
          for (const movement of movements) {
            console.log(
              `[nav-guard]   ${movement.text.padEnd(14)} ${String(movement.fallbackWidth).padStart(6)} → ` +
                `${String(movement.webFontWidth).padStart(6)}  ${String(movement.ratio).padStart(6)}%  shift ${String(movement.shift).padStart(6)}px`,
            );
          }
          if (worst >= MATERIAL_MOVEMENT_PX) {
            const resolved = await page.evaluate((families) => {
              const size = getComputedStyle(document.querySelector("header nav ul li a")).fontSize;
              return families.filter((family) => document.fonts.check(`${size} "${family}"`));
            }, FALLBACK_FAMILIES);
            console.log(
              `[nav-guard] ${theme} @ ${width}px calibrated fallback resolved: ${resolved.join(", ") || "(none)"}; ` +
                `text-rendering: ${await page.evaluate(() => getComputedStyle(document.querySelector("header nav ul li a")).textRendering)}`,
            );
            /*
             * A shift that every label shares is not a label problem: it comes
             * from a box beside the navigation changing width (the wordmark,
             * the logo, the theme toggle, the container). These deltas name it.
             */
            const boxes = Object.keys(boxesAfter)
              .map((key) => {
                const start = boxesBefore[key];
                const end = boxesAfter[key];
                if (!start || !end) return `${key} n/a`;
                return `${key} Δleft ${(end[0] - start[0]).toFixed(2)} Δwidth ${(end[1] - start[1]).toFixed(2)}`;
              })
              .join("; ");
            console.log(`[nav-guard] ${theme} @ ${width}px header boxes: ${boxes}`);
          }

          expect(
            worst,
            `${theme} @ ${width}px: navigation items moved up to ${worst}px after the web font loaded: ${JSON.stringify(movements)}`,
          ).toBeLessThan(MATERIAL_MOVEMENT_PX);

          if (usesDrawer) {
            // The drawer's links must also be top of the stack at their centre.
            const covered = await page.evaluate(() =>
              [...document.querySelectorAll("header nav ul li a")]
                .map((anchor) => {
                  const rect = anchor.getBoundingClientRect();
                  const top = document.elementFromPoint(
                    rect.left + rect.width / 2,
                    rect.top + rect.height / 2,
                  );
                  return top && (top === anchor || anchor.contains(top))
                    ? null
                    : anchor.textContent.trim();
                })
                .filter(Boolean),
            );
            expect(covered, `${theme} @ ${width}px: drawer links covered`).toEqual([]);
          }
        });
      }
    }
  });

  test("a click aimed at the painted navigation label still reaches that link", async ({
    page,
  }) => {
    // Emulates a cold load, where the web font arrives after the first paint.
    await delayFonts(page, 1_500);

    await page.goto("/fixtures.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(
      () =>
        new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );

    // Where the user sees "News & Events" and aims: every point across the
    // painted label, including its right-hand end.
    const painted = linkNamed(await navGeometry(page), "News & Events");
    const y = (painted.top + painted.bottom) / 2;
    const samplePoints = Array.from({ length: 9 }, (_, index) => {
      const ratio = (index + 1) / 10;
      return Math.round((painted.left + painted.width * ratio) * 100) / 100;
    });

    // The font arrives and the navigation re-flows under the same point.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);

    const hits = await page.evaluate(
      ({ points, y }) =>
        points.map((x) => {
          const top = document.elementFromPoint(x, y);
          const anchor = top?.closest?.("a");
          return {
            x,
            element: top ? `${top.tagName.toLowerCase()}.${[...top.classList].join(".")}` : "none",
            anchorText: anchor?.textContent.trim() ?? null,
            anchorHref: anchor?.getAttribute("href") ?? null,
          };
        }),
      { points: samplePoints, y },
    );

    const missed = hits.filter((hit) => hit.anchorHref !== "news.html");
    expect(
      missed,
      "Points that displayed the News & Events label before the font loaded no longer hit it: " +
        missed
          .map((hit) => `x=${Math.round(hit.x)} -> ${hit.element}${hit.anchorText ? ` ("${hit.anchorText}")` : ""}`)
          .join(", "),
    ).toEqual([]);

    // And a real click at the worst point must navigate to the News page.
    const worstPoint = missed[0] ?? hits[hits.length - 1];
    const navigation = page.waitForNavigation({ timeout: 5_000 }).catch(() => null);
    await page.mouse.click(worstPoint.x, y);
    await navigation;
    expect(new URL(page.url()).pathname).toBe("/news.html");
  });

  test("100 rapid Fixtures <-> News clicks all navigate", async ({ page }) => {
    await page.goto("/fixtures.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);

    const failures = [];
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const wantNews = attempt % 2 === 0;
      const label = wantNews ? "News & Events" : "Fixtures";
      const expected = wantNews ? "/news.html" : "/fixtures.html";

      const geometry = await navGeometry(page);
      const target = linkNamed(geometry, label);
      if (!target || target.width === 0 || target.height === 0) {
        failures.push(`attempt ${attempt}: "${label}" has no usable box`);
        break;
      }

      const point = { x: target.left + target.width / 2, y: (target.top + target.bottom) / 2 };
      const topmost = await page.evaluate(
        ({ x, y }) => {
          const top = document.elementFromPoint(x, y);
          const anchor = top?.closest?.("a");
          return anchor?.textContent.trim() ?? null;
        },
        point,
      );
      if (topmost !== label) {
        failures.push(`attempt ${attempt}: centre of "${label}" is covered by "${topmost}"`);
        break;
      }

      const navigation = page.waitForNavigation({ timeout: 5_000 }).catch(() => null);
      await page.mouse.click(point.x, point.y);
      const navigated = await navigation;
      if (!navigated) {
        failures.push(`attempt ${attempt}: clicking "${label}" started no navigation`);
        break;
      }
      await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});
      await page
        .waitForFunction(() => document.readyState !== "loading", null, { timeout: 5_000 })
        .catch(() => {});
      const path = new URL(page.url()).pathname;
      if (path !== expected) {
        failures.push(`attempt ${attempt}: expected ${expected}, landed on ${path}`);
        break;
      }
    }

    expect(failures).toEqual([]);
  });
});
