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

          const movements = after.map((entry) => {
            const previous = linkNamed(before, entry.text);
            return {
              text: entry.text,
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
