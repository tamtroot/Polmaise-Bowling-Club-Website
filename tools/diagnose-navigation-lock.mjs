import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { chromium } from "playwright";
import { createStaticServer } from "./static-server.mjs";

/**
 * Stage 11 diagnostic (investigation only — makes no changes to the site).
 *
 * Drives the visible desktop header navigation with real mouse clicks,
 * alternating Fixtures <-> News & Events, and stops at the first click that
 * does not start a document navigation. On failure it dumps everything needed
 * to identify the mechanism: every News/Fixtures anchor in the DOM, the hit
 * test at the target's centre, the element stack above the click point, the
 * event sequence with defaultPrevented states, and the navigation requests.
 *
 * Usage:
 *   node tools/diagnose-navigation-lock.mjs [--iterations=120] [--mode=rapid|settled]
 *                                           [--base=http://127.0.0.1:4190]
 */
const root = process.cwd();
const siteRoot = path.resolve(root, process.env.SITE_ROOT ?? "_site");
const argument = (name, fallback) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;

const iterations = Number(argument("iterations", "120"));
/** The calibrated fallback families defined in styles.css, in stack order. */
const FALLBACK_FAMILIES = [
  "Open Sans Fallback Arial",
  "Open Sans Fallback Segoe",
  "Open Sans Fallback Tahoma",
  "Open Sans Fallback Liberation",
];
const mode = argument("mode", "rapid");
const inventoryOnly = process.argv.includes("--inventory");
const width = Number(argument("width", "1440"));
const height = Number(argument("height", "900"));
const theme = argument("theme", "light");
const serverProfile = argument("server", "nostore");
const externalBase = argument("base", null);
const port = Number(argument("port", "4190"));
const reportPath = path.join(root, "reports", "stage11", "navigation-lock-diagnosis.json");

/**
 * `--tune` can measure a font *file* as well as an installed family, which is
 * how the Linux fallback (Liberation Sans) is calibrated from a machine that
 * does not have it installed:
 *
 *   node tools/diagnose-navigation-lock.mjs --tune \
 *     --font-file=/tmp/LiberationSans-Regular.ttf --font-name="Liberation Sans"
 */
const tuneFontFile = argument("font-file", null);
const tuneFontName = argument("font-name", tuneFontFile ? path.basename(tuneFontFile) : null);
const tuneFontUrl = tuneFontFile ? `https://fonts.test/${path.basename(tuneFontFile)}` : null;

let server = null;
const base = externalBase ?? `http://127.0.0.1:${port}`;

if (!externalBase) {
  server =
    serverProfile === "nostore"
      ? createStaticServer(siteRoot)
      : createCachingServer(siteRoot, serverProfile);
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
}

/**
 * Reproduces the two server profiles the defect was reported against:
 *  - "serve": 301 clean URLs plus a one-hour cache, like `npx serve`
 *  - "python": Last-Modified only, like `python -m http.server`
 */
function createCachingServer(rootDirectory, profile) {
  const root = path.resolve(rootDirectory);
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    let pathname = decodeURIComponent(url.pathname);
    if (profile === "serve" && pathname.endsWith(".html")) {
      response.writeHead(301, { Location: pathname.replace(/\.html$/, "") + url.search });
      response.end();
      return;
    }
    if (profile === "serve" && !pathname.includes(".")) {
      pathname = `${pathname.replace(/\/$/, "")}.html`;
    }
    const filePath = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    let stats;
    try {
      stats = statSync(filePath);
    } catch {
      response.writeHead(404);
      response.end("Not Found");
      return;
    }
    const extension = path.extname(filePath).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".woff2": "font/woff2",
      ".webp": "image/webp",
      ".png": "image/png",
      ".gif": "image/gif",
      ".jpg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".json": "application/json",
    };
    const headers = {
      "Content-Type": types[extension] ?? "application/octet-stream",
      "Content-Length": stats.size,
      "Last-Modified": stats.mtime.toUTCString(),
      ETag: `"${stats.size.toString(16)}-${stats.mtimeMs.toString(16)}"`,
    };
    if (profile === "serve") headers["Cache-Control"] = "public, max-age=3600";
    response.writeHead(200, headers);
    createReadStream(filePath).pipe(response);
  });
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: 1,
});

// Records the event sequence and any preventDefault() call with its stack.
const instrumentation = () => {
  const describe = (node) => {
    if (!node || node.nodeType !== 1) {
      return node === null ? "null" : String(node?.nodeName ?? node);
    }
    const classes = [...node.classList].slice(0, 3).join(".");
    return `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}${classes ? `.${classes}` : ""}`;
  };
  const state = {
    events: [],
    prevented: [],
    clicks: [],
    navigations: [],
  };
  window.__navDiag = state;

  const record = (type, phase) => (event) => {
    state.events.push({
      type: `${type}:${phase}`,
      at: Math.round(performance.now()),
      target: describe(event.target),
      path: (event.composedPath?.() ?? []).slice(0, 5).map(describe).join(" < "),
      defaultPrevented: event.defaultPrevented,
      cancelable: event.cancelable,
      button: event.button,
      detail: event.detail,
      clientX: Math.round(event.clientX ?? 0),
      clientY: Math.round(event.clientY ?? 0),
    });
    if (state.events.length > 400) state.events.splice(0, 200);
  };

  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "auxclick"]) {
    window.addEventListener(type, record(type, "capture"), true);
    window.addEventListener(type, record(type, "bubble"), false);
  }

  const originalPreventDefault = Event.prototype.preventDefault;
  Event.prototype.preventDefault = function preventDefault() {
    state.prevented.push({
      type: this.type,
      target: describe(this.target),
      at: Math.round(performance.now()),
      stack: String(new Error().stack ?? "").split("\n").slice(1, 6).join(" | "),
    });
    if (state.prevented.length > 200) state.prevented.splice(0, 100);
    return originalPreventDefault.call(this);
  };

  // Anchor clicks that reach a navigation decision.
  window.addEventListener(
    "click",
    (event) => {
      const anchor = event.target?.closest?.("a[href]");
      if (!anchor) return;
      state.clicks.push({
        href: anchor.getAttribute("href"),
        text: anchor.textContent.trim().slice(0, 40),
        at: Math.round(performance.now()),
        defaultPrevented: event.defaultPrevented,
        stopped: event.cancelBubble,
      });
    },
    false,
  );
};

const page = await context.newPage();
await page.addInitScript(instrumentation);
if (theme === "dark") {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("polmaise-theme", "dark");
    } catch (error) {
      /* storage unavailable */
    }
  });
}

const documentRequests = [];
page.on("request", (request) => {
  if (request.resourceType() === "document") {
    documentRequests.push({ url: request.url(), at: Date.now(), frame: request.frame().url() });
  }
});
page.on("framenavigated", (frame) => {
  if (frame === page.mainFrame()) {
    documentRequests.push({ url: frame.url(), at: Date.now(), event: "framenavigated" });
  }
});

/** Everything the brief asks for about anchors whose text mentions a label. */
const inventory = (label) =>
  page.evaluate((label) => {
    const describeNode = (node) => {
      if (!node || node.nodeType !== 1) return String(node?.nodeName ?? node);
      const classes = [...node.classList].slice(0, 4).join(".");
      return `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}${classes ? `.${classes}` : ""}`;
    };
    const pathOf = (node) => {
      const parts = [];
      let current = node;
      while (current && current.nodeType === 1 && parts.length < 6) {
        parts.unshift(describeNode(current));
        current = current.parentElement;
      }
      return parts.join(" > ");
    };
    const hitTest = (element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return { hit: false, reason: "zero-size" };
      }
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) {
        return { hit: false, reason: "outside-viewport", x, y };
      }
      const top = document.elementFromPoint(x, y);
      return {
        hit: Boolean(top && (top === element || element.contains(top) || top.contains(element))),
        top: describeNode(top),
        x: Math.round(x),
        y: Math.round(y),
      };
    };

    const results = [];
    for (const anchor of document.querySelectorAll("a")) {
      if (!anchor.textContent.includes(label)) continue;
      const style = getComputedStyle(anchor);
      const rect = anchor.getBoundingClientRect();
      const nav = anchor.closest("nav");
      const drawer = anchor.closest(".mobile-nav-dropdown");
      results.push({
        text: anchor.textContent.trim().slice(0, 40),
        href: anchor.getAttribute("href"),
        resolvedHref: anchor.href,
        path: pathOf(anchor),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
        position: style.position,
        transform: style.transform,
        zIndex: style.zIndex,
        classes: [...anchor.classList].join(" "),
        ariaCurrent: anchor.getAttribute("aria-current"),
        owner: drawer ? "mobile-dropdown" : nav ? "header-nav" : "page",
        navVisible: nav ? getComputedStyle(nav.querySelector("ul") ?? nav).display !== "none" : null,
        hitTest: hitTest(anchor),
      });
    }
    return results;
  }, label);

/** Resolve the single visible, hit-testable desktop header link for a label. */
const visibleDesktopLink = (label) =>
  page.evaluate((label) => {
    const describeNode = (node) => {
      if (!node || node.nodeType !== 1) return String(node?.nodeName ?? node);
      const classes = [...node.classList].slice(0, 4).join(".");
      return `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}${classes ? `.${classes}` : ""}`;
    };
    const candidates = [...document.querySelectorAll("a")].filter(
      (anchor) => anchor.textContent.trim() === label,
    );
    const scored = candidates.map((anchor) => {
      const rect = anchor.getBoundingClientRect();
      const style = getComputedStyle(anchor);
      const inHeaderNav = Boolean(anchor.closest("header nav ul"));
      const withinViewport =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top < innerHeight &&
        rect.bottom > 0 &&
        rect.left >= 0 &&
        rect.right <= innerWidth;
      let hit = null;
      if (rect.width > 0 && rect.height > 0) {
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const top = document.elementFromPoint(x, y);
        hit = {
          x: Math.round(x),
          y: Math.round(y),
          top: describeNode(top),
          ok: Boolean(top && (top === anchor || anchor.contains(top))),
        };
      }
      return {
        okay: inHeaderNav && withinViewport && Boolean(hit?.ok),
        inHeaderNav,
        withinViewport,
        href: anchor.getAttribute("href"),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        display: style.display,
        visibility: style.visibility,
        pointerEvents: style.pointerEvents,
        classes: [...anchor.classList].join(" "),
        hit,
      };
    });
    return { count: candidates.length, chosen: scored.find((entry) => entry.okay) ?? null, scored };
  }, label);

/** The full picture at the click point, including everything stacked above it. */
const clickPointDiagnostics = (label, x, y) =>
  page.evaluate(
    ({ label, x, y }) => {
      const describeNode = (node) => {
        if (!node || node.nodeType !== 1) return String(node?.nodeName ?? node);
        const classes = [...node.classList].slice(0, 4).join(".");
        return `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}${classes ? `.${classes}` : ""}`;
      };
      const detail = (node) => {
        if (!node || node.nodeType !== 1) return { node: describeNode(node) };
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return {
          node: describeNode(node),
          rect: [
            Math.round(rect.x),
            Math.round(rect.y),
            Math.round(rect.width),
            Math.round(rect.height),
          ],
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          pointerEvents: style.pointerEvents,
          position: style.position,
          zIndex: style.zIndex,
          transform: style.transform,
          overflow: style.overflow,
          background: style.backgroundColor,
          text: (node.textContent ?? "").trim().slice(0, 30),
        };
      };
      const anchors = [...document.querySelectorAll("a")].filter((anchor) =>
        anchor.textContent.includes(label),
      );
      const anchor = anchors.find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && candidate.closest("header nav ul");
      });
      const ancestors = [];
      let current = anchor;
      while (current && current.nodeType === 1 && ancestors.length < 8) {
        ancestors.push(detail(current));
        current = current.parentElement;
      }
      const navUl = document.querySelector("header nav ul");
      return {
        at: { x: Math.round(x), y: Math.round(y) },
        elementFromPoint: detail(document.elementFromPoint(x, y)),
        elementsFromPoint: document.elementsFromPoint(x, y).map(detail),
        anchor: anchor ? detail(anchor) : null,
        ancestors,
        documentState: {
          htmlClass: document.documentElement.className,
          htmlDataTheme: document.documentElement.getAttribute("data-theme"),
          bodyClass: document.body.className,
          readyState: document.readyState,
          url: location.href,
          activeElement: describeNode(document.activeElement),
          hasFocus: document.hasFocus(),
          scrollY: Math.round(scrollY),
        },
        navState: {
          ulClass: navUl?.className ?? null,
          ulDisplay: navUl ? getComputedStyle(navUl).display : null,
          ulPosition: navUl ? getComputedStyle(navUl).position : null,
          ulRect: navUl
            ? [
                Math.round(navUl.getBoundingClientRect().x),
                Math.round(navUl.getBoundingClientRect().y),
                Math.round(navUl.getBoundingClientRect().width),
                Math.round(navUl.getBoundingClientRect().height),
              ]
            : null,
          mobileMenuDisplay: document.querySelector(".mobile-menu")
            ? getComputedStyle(document.querySelector(".mobile-menu")).display
            : null,
          desktopBreakpoint: window.matchMedia("(min-width: 1280px)").matches,
          drawerOpen: Boolean(document.querySelector("nav ul.show")),
          viewport: [innerWidth, innerHeight],
        },
        // Every element in the header, to expose stray overlays or duplicates.
        headerTree: (() => {
          const header = document.querySelector("header");
          if (!header) return [];
          return [...header.querySelectorAll("*")].slice(0, 60).map((node) => {
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return {
              node: describeNode(node),
              rect: [
                Math.round(rect.x),
                Math.round(rect.y),
                Math.round(rect.width),
                Math.round(rect.height),
              ],
              display: style.display,
              position: style.position,
              zIndex: style.zIndex,
              pointerEvents: style.pointerEvents,
            };
          });
        })(),
        events: window.__navDiag?.events?.slice(-40) ?? [],
        prevented: window.__navDiag?.prevented?.slice(-20) ?? [],
        anchorClicks: window.__navDiag?.clicks?.slice(-20) ?? [],
      };
    },
    { label, x, y },
  );

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Rapid clicking means a navigation can commit while we are querying the DOM.
 * Retry those evaluations instead of treating them as the failure.
 */
async function retryEvaluation(fn, argument, attempts = 20, delay = 100) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn(argument);
    } catch (error) {
      lastError = error;
      if (!/Execution context was destroyed|Target closed|frame was detached/i.test(error.message)) {
        throw error;
      }
      await sleep(delay);
    }
  }
  throw lastError;
}

const report = {
  startedAt: new Date().toISOString(),
  base,
  mode,
  iterations,
  width,
  height,
  theme,
  serverProfile,
  steps: [],
  inventories: {},
  failure: null,
  documentRequests,
};

try {
  if (inventoryOnly) {
    const { SITE_PAGES } = await import("../tests/helpers/site-pages.mjs");
    report.pageInventory = [];
    for (const sitePage of SITE_PAGES) {
      await page.goto(`${base}${sitePage.path}`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => {});
      report.pageInventory.push({
        page: sitePage.path,
        news: await inventory("News"),
        fixtures: await inventory("Fixtures"),
      });
      const hidden = [...(await inventory("News")), ...(await inventory("Fixtures"))].filter(
        (entry) => !entry.hitTest.hit,
      );
      console.log(
        `${sitePage.path}: news=${(await inventory("News")).length} fixtures=${(await inventory("Fixtures")).length} not-hit-testable=${hidden.length}`,
      );
    }
    throw new Error("__inventory_complete__");
  }

  if (process.argv.includes("--geometry")) {
    const { SITE_PAGES } = await import("../tests/helpers/site-pages.mjs");
    report.geometry = [];
    for (const sitePage of SITE_PAGES) {
      await page.goto(`${base}${sitePage.path}`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => {});
      await sleep(150);
      const measured = await page.evaluate(() => {
        const rect = (element) => {
          if (!element) return null;
          const box = element.getBoundingClientRect();
          return {
            left: Math.round(box.left * 100) / 100,
            right: Math.round(box.right * 100) / 100,
            width: Math.round(box.width * 100) / 100,
            centre: Math.round(((box.left + box.right) / 2) * 100) / 100,
          };
        };
        const navLinks = [...document.querySelectorAll("header nav ul li a")].map((anchor) => ({
          text: anchor.textContent.trim(),
          ...rect(anchor),
          bold: getComputedStyle(anchor).fontWeight,
        }));
        return {
          innerWidth,
          documentWidth: document.documentElement.clientWidth,
          scrollbarWidth: window.innerWidth - document.documentElement.clientWidth,
          scrollHeight: document.documentElement.scrollHeight,
          hasVerticalScrollbar: document.documentElement.scrollHeight > innerHeight,
          navRight: rect(document.querySelector("header nav ul"))?.right ?? null,
          toggleLeft: rect(document.querySelector("[data-theme-toggle]"))?.left ?? null,
          active: document.querySelector("header nav ul li a.active")?.textContent.trim() ?? null,
          navLinks,
        };
      });
      report.geometry.push({ page: sitePage.path, ...measured });
      const news = measured.navLinks.find((link) => link.text.startsWith("News"));
      const fixtures = measured.navLinks.find((link) => link.text === "Fixtures");
      console.log(
        `${sitePage.path}: scrollbar=${measured.scrollbarWidth} innerWidth=${measured.innerWidth} active=${measured.active} fixtures=[${fixtures?.left}-${fixtures?.right}] news=[${news?.left}-${news?.right}] gap=${news && fixtures ? (news.left - fixtures.right).toFixed(2) : "?"}`,
      );
    }
    throw new Error("__geometry_complete__");
  }

  if (process.argv.includes("--fontshift")) {
    // How far do the nav hit targets move when the web font swaps in?
    const measure = () =>
      page.evaluate(() => {
        const box = (element) => {
          const rect = element.getBoundingClientRect();
          return {
            left: Math.round(rect.left * 100) / 100,
            right: Math.round(rect.right * 100) / 100,
            centre: Math.round(((rect.left + rect.right) / 2) * 100) / 100,
          };
        };
        return [...document.querySelectorAll("header nav ul li a")].map((anchor) => ({
          text: anchor.textContent.trim(),
          ...box(anchor),
          font: getComputedStyle(anchor).fontFamily,
        }));
      });

    const fontFiles = /\.woff2$/;
    const blocked = [];
    await page.route(fontFiles, async (route) => {
      blocked.push(route.request().url());
      await route.abort();
    });
    await page.goto(`${base}/fixtures.html`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load", { timeout: 8_000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await sleep(200);
    const beforeSwap = await measure();
    await page.unroute(fontFiles);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    await sleep(200);
    const afterSwap = await measure();
    report.fontShift = { beforeSwap, afterSwap, blocked: blocked.length };
    for (const item of afterSwap) {
      const previous = beforeSwap.find((entry) => entry.text === item.text);
      if (!previous) continue;
      console.log(
        `${item.text}: fallback=[${previous.left},${previous.right}] webfont=[${item.left},${item.right}] shift=${(item.left - previous.left).toFixed(2)}px`,
      );
    }
    throw new Error("__fontshift_complete__");
  }

  if (process.argv.includes("--repro")) {
    /*
     * Deterministic reproduction of the reported symptom.
     *
     * The webfont swap re-flows the right-aligned navigation ~10-18px after
     * first paint, on every navigation. This mode aims at the News & Events
     * link while the fallback font is still in place, holds the mouse down
     * across the swap, and records where the click ends up.
     */
    const fontDelay = Number(argument("fontdelay", "700"));
    const linkGeometry = () =>
      page.evaluate(() => {
        const navLinks = [...document.querySelectorAll("header nav ul li a")].map((anchor) => {
          const rect = anchor.getBoundingClientRect();
          return {
            text: anchor.textContent.trim(),
            left: Math.round(rect.left * 100) / 100,
            right: Math.round(rect.right * 100) / 100,
            top: Math.round(rect.top * 100) / 100,
            bottom: Math.round(rect.bottom * 100) / 100,
          };
        });
        return {
          navLinks,
          fontsReady: document.fonts.status,
          openSansLoaded: document.fonts.check('16px "Open Sans"'),
        };
      });
    const hitAt = (x, y) =>
      page.evaluate(
        ({ x, y }) => {
          const top = document.elementFromPoint(x, y);
          const anchor = top?.closest?.("a");
          const describe = (node) =>
            node ? `${node.tagName.toLowerCase()}${node.className ? `.${[...node.classList].join(".")}` : ""}` : "none";
          return {
            top: describe(top),
            anchorText: anchor?.textContent.trim() ?? null,
            anchorHref: anchor?.getAttribute("href") ?? null,
          };
        },
        { x, y },
      );

    // Delay the font stylesheet so the page paints with fallback metrics and
    // re-flows once the real font arrives — the same sequence a cold load has,
    // but on a schedule we can measure.
    await page.route(/vendor\/fonts\/fonts\.css$/, async (route) => {
      await sleep(fontDelay);
      await route.continue();
    });
    await page.goto(`${base}/fixtures.html`, { waitUntil: "domcontentloaded" });
    const beforeSwap = await linkGeometry();
    const newsBefore = beforeSwap.navLinks.find((link) => link.text === "News & Events");
    // Aim at the left-hand end of the label, where a user clicks the "N".
    const aim = { x: newsBefore.left + 3, y: (newsBefore.top + newsBefore.bottom) / 2 };
    const hitBeforeSwap = await hitAt(aim.x, aim.y);

    // Let the font arrive: the navigation re-flows under the same point.
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await sleep(300);
    const afterSwap = await linkGeometry();
    const hitAfterSwap = await hitAt(aim.x, aim.y);

    // Variant A: click at the coordinates the user aimed at, now the font has
    // swapped (the user's pointer has not moved).
    const beforeA = documentRequests.length;
    await page.mouse.move(aim.x, aim.y);
    await page.mouse.down();
    await page.mouse.up();
    await sleep(700);
    const navigatedA = documentRequests.length > beforeA;
    const urlA = page.url();

    const fixturesBefore = beforeSwap.navLinks.find((link) => link.text === "Fixtures");
    const fixturesAfter = afterSwap.navLinks.find((link) => link.text === "Fixtures");

    /*
     * Now reproduce the user's symptom with real clicks at the points the
     * re-flow vacates: each aim point is inside "News & Events" before the font
     * arrives, and lands on its neighbour or in the 4px dead gap afterwards.
     */
    const newsAfter = afterSwap.navLinks.find((link) => link.text === "News & Events");
    const galleryAfter = afterSwap.navLinks.find((link) => link.text === "Gallery");
    const gapStart = newsAfter.right;
    const gapEnd = galleryAfter.left;
    const newsWidth = newsBefore.right - newsBefore.left;
    const trials = Array.from({ length: 15 }, (_, index) => {
      const ratio = (index + 1) / 16;
      return {
        name: `${Math.round(ratio * 100)}% across the label`,
        x: Math.round((newsBefore.left + newsWidth * ratio) * 100) / 100,
      };
    });
    const y = (newsBefore.top + newsBefore.bottom) / 2;
    const trialResults = [];
    let failureState = null;
    for (const trial of trials) {
      const before = documentRequests.length;
      const hitBefore = await hitAt(trial.x, y);
      // Only meaningful if the point was inside the News link beforehand.
      await page.mouse.move(trial.x, y);
      await page.mouse.down();
      await page.mouse.up();
      await sleep(600);
      trialResults.push({
        name: trial.name,
        x: trial.x,
        y: Math.round(y),
        hitAfterSwap: hitBefore,
        navigated: documentRequests.length > before,
        url: page.url(),
      });
      if (trial.name === "dead gap after re-flow") {
        failureState = await clickPointDiagnostics("News", trial.x, y);
      }
      if (page.url().includes("news.html") || page.url().includes("gallery.html")) {
        await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
        await page.evaluate(() => document.fonts.ready).catch(() => {});
        await sleep(200);
      }
    }

    report.repro = {
      fontDelay,
      beforeSwap,
      afterSwap,
      aim,
      hitBeforeSwap,
      hitAfterSwap,
      shifts: {
        news: Math.round((afterSwap.navLinks.find((link) => link.text === "News & Events")?.left - newsBefore.left) * 100) / 100,
        fixtures: Math.round((fixturesAfter.left - fixturesBefore.left) * 100) / 100,
      },
      gap: { start: gapStart, end: gapEnd, width: Math.round((gapEnd - gapStart) * 100) / 100 },
      trials: trialResults,
      headerStateAtGap: failureState
        ? {
            documentState: failureState.documentState,
            navState: failureState.navState,
            elementFromPoint: failureState.elementFromPoint,
            elementsFromPoint: failureState.elementsFromPoint.slice(0, 5),
            ancestors: failureState.ancestors,
            prevented: failureState.prevented,
          }
        : null,
      variantA: {
        navigated: navigatedA,
        url: urlA,
        clicks: await page.evaluate(() => window.__navDiag?.clicks?.slice(-3) ?? []),
      },
    };
    console.log(`pre-swap  news=[${newsBefore.left}, ${newsBefore.right}]  fixtures=[${fixturesBefore.left}, ${fixturesBefore.right}]  fonts=${beforeSwap.fontsReady}`);
    console.log(`post-swap news=[${afterSwap.navLinks.find((l) => l.text === "News & Events")?.left}, ${afterSwap.navLinks.find((l) => l.text === "News & Events")?.right}]  fixtures=[${fixturesAfter.left}, ${fixturesAfter.right}]  fonts=${afterSwap.fontsReady}`);
    console.log(`shift on swap: news ${report.repro.shifts.news}px, fixtures ${report.repro.shifts.fixtures}px`);
    console.log(`aim x=${Math.round(aim.x)} -> before swap hit ${hitBeforeSwap.top} (${hitBeforeSwap.anchorText}); after swap hit ${hitAfterSwap.top} (${hitAfterSwap.anchorText} -> ${hitAfterSwap.anchorHref})`);
    console.log(`click result: navigated=${navigatedA} url=${urlA}`);
    console.log(`post-re-flow gap between News & Events and Gallery: [${gapStart}, ${gapEnd}] = ${report.repro.gap.width}px`);
    for (const trial of trialResults) {
      console.log(
        `  ${trial.name.padEnd(26)} x=${trial.x} -> hit ${trial.hitAfterSwap.top} (${trial.hitAfterSwap.anchorText ?? "no anchor"}) navigated=${trial.navigated} url=${trial.url.replace(base, "")}`,
      );
    }
    throw new Error("__repro_complete__");
  }

  if (process.argv.includes("--tune")) {
    /*
     * Finds the local fallback face (and size-adjust value) whose metrics best
     * match the real webfont, so the navigation cannot move when the font
     * arrives. Reports the largest per-item displacement across the nav.
     */
    if (tuneFontFile) {
      const bytes = readFileSync(path.resolve(tuneFontFile));
      await page.route("https://fonts.test/**", (route) =>
        route.fulfill({
          status: 200,
          headers: { "Content-Type": "font/ttf", "Access-Control-Allow-Origin": "*" },
          body: bytes,
        }),
      );
    }

    await page.goto(`${base}/fixtures.html`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    /*
     * Tune against real layout, not canvas metrics: the nav is right-aligned,
     * glyph advances are rounded during layout and the active item is bold, so
     * only measured rectangles can predict where a click would land.
     */
    const tuning = await page.evaluate(
      async ({ fontName, fontUrl }) => {
      const links = [...document.querySelectorAll("header nav ul li a")];
      const read = () => links.map((anchor) => anchor.getBoundingClientRect().left);
      const readWidths = () =>
        links.map((anchor) => anchor.getBoundingClientRect().width);

      const reference = read();
      const referenceWidths = readWidths();
      const scenarios = links.map((_, index) => index);
      const results = [];

      const sources = fontUrl
        ? [{ family: fontName, src: `url(${fontUrl}) format('truetype')` }]
        : ["Tahoma", "Arial", "Segoe UI", "Trebuchet MS", "Verdana", "system-ui"].map(
            (family) => ({ family, src: `local('${family}')` }),
          );
      for (const source of sources) {
        for (let adjust = 92; adjust <= 112; adjust += 0.25) {
          const style = document.createElement("style");
          style.textContent =
            `@font-face{font-family:'TuneFallback';src:${source.src};` +
            `size-adjust:${adjust}%;ascent-override:106.88%;descent-override:29.29%;line-gap-override:0%;}` +
            `header nav ul li a{font-family:'TuneFallback',sans-serif !important;}`;
          document.head.append(style);
          // A file-based face loads asynchronously (an installed family does
          // not); wait for it so the measurement is of the font, not of the
          // fallback the browser is still using.
          await document.fonts.load("16px 'TuneFallback'").catch(() => {});

          let worst = 0;
          for (const active of scenarios) {
            links.forEach((anchor, index) =>
              anchor.classList.toggle("active", index === active),
            );
            const lefts = read();
            const widths = readWidths();
            // Right-aligned nav: the left edge of an item is the running total
            // of everything to its right, so errors accumulate leftwards.
            let runningLocal = 0;
            let runningReference = 0;
            for (let index = links.length - 1; index >= 0; index -= 1) {
              runningLocal += widths[index];
              runningReference += referenceWidths[index];
              worst = Math.max(worst, Math.abs(runningLocal - runningReference));
            }
            worst = Math.max(worst, Math.abs(lefts[0] - reference[0]));
          }
          style.remove();
          results.push({
            family: source.family,
            adjust,
            worstShiftPx: Math.round(worst * 100) / 100,
          });
        }
      }
      // Restore the page's own active item.
      links.forEach((anchor, index) =>
        anchor.classList.toggle("active", anchor.getAttribute("href")?.includes("fixtures") ?? false),
      );
      results.sort((left, right) => left.worstShiftPx - right.worstShiftPx);
      const bestPerFamily = [];
      for (const family of [...new Set(results.map((entry) => entry.family))]) {
        const best = results.find((entry) => entry.family === family);
        if (best) bestPerFamily.push(best);
      }
      return { reference, referenceWidths, top: results.slice(0, 10), bestPerFamily };
      },
      { fontName: tuneFontName, fontUrl: tuneFontUrl },
    );

    report.tuning = tuning;
    console.log("worst-case nav shift, all active pages (real layout):");
    for (const candidate of tuning.top) {
      console.log(
        `  ${candidate.family.padEnd(13)} size-adjust ${candidate.adjust.toFixed(2)}%  worst shift ${candidate.worstShiftPx}px`,
      );
    }
    console.log("best per family:");
    for (const candidate of tuning.bestPerFamily) {
      console.log(
        `  ${candidate.family.padEnd(13)} size-adjust ${candidate.adjust.toFixed(2)}%  worst shift ${candidate.worstShiftPx}px`,
      );
    }
    throw new Error("__tune_complete__");
  }

  if (process.argv.includes("--probe")) {
    // Force the fallback state so the probe reports the font the user would
    // see before the web font arrives.
    await page.route(/\.woff2$/, (route) => route.abort());
    await page.goto(`${base}/fixtures.html`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(200);
    const probe = await page.evaluate(() => {
      const anchor = [...document.querySelectorAll("header nav ul li a")].find(
        (candidate) => candidate.textContent.trim() === "News & Events",
      );
      const context = document.createElement("canvas").getContext("2d");
      const width = (font) => {
        context.font = font;
        return Math.round(context.measureText("News & Events").width * 100) / 100;
      };
      const size = getComputedStyle(anchor).fontSize;
      return {
        computedFamily: getComputedStyle(anchor).fontFamily,
        webFontLoaded: document.fonts.check(`${size} "Open Sans"`),
        fallbackFamily: FALLBACK_FAMILIES.find((family) => document.fonts.check(`${size} "${family}"`)) ?? null,
        tahomaAvailable: document.fonts.check(`${size} Tahoma`),
        arialAvailable: document.fonts.check(`${size} Arial`),
        widths: {
          webFont: width(`${size} "Open Sans"`),
          fallbackFamily: width(
            `${size} "${FALLBACK_FAMILIES.find((family) => document.fonts.check(`${size} "${family}"`)) ?? "Open Sans Fallback Arial"}"`,
          ),
          tahoma: width(`${size} Tahoma`),
          arial: width(`${size} Arial`),
          segoe: width(`${size} "Segoe UI"`),
        },
        faces: [...document.fonts].map((face) => ({
          family: face.family,
          weight: face.weight,
          status: face.status,
          sizeAdjust: face.sizeAdjust ?? null,
        })),
      };
    });
    // Ask Chromium which platform font it really used for a nav link.
    let platformFonts = null;
    try {
      const client = await page.context().newCDPSession(page);
      await client.send("DOM.enable");
      await client.send("CSS.enable");
      const { root } = await client.send("DOM.getDocument");
      const { nodeId } = await client.send("DOM.querySelector", {
        nodeId: root.nodeId,
        selector: "header nav ul li a",
      });
      platformFonts = await client.send("CSS.getPlatformFontsForNode", { nodeId });
      await client.detach();
    } catch (error) {
      platformFonts = { error: error.message };
    }
    report.probe = { ...probe, platformFonts };
    console.log(JSON.stringify({ ...probe, platformFonts }, null, 1));
    throw new Error("__probe_complete__");
  }

  if (process.argv.includes("--drawer")) {
    const snapshot = (label) =>
      page.evaluate((label) => {
        const ul = document.querySelector("header nav ul");
        const rect = ul.getBoundingClientRect();
        const style = getComputedStyle(ul);
        const link = ul.querySelector("li a");
        const linkRect = link.getBoundingClientRect();
        return {
          label,
          ul: {
            left: Math.round(rect.left * 100) / 100,
            width: Math.round(rect.width * 100) / 100,
            scrollWidth: ul.scrollWidth,
            clientWidth: ul.clientWidth,
            overflowY: style.overflowY,
            padding: style.padding,
            display: style.display,
            position: style.position,
            transition: style.transitionProperty,
          },
          firstLink: {
            text: link.textContent.trim(),
            left: Math.round(linkRect.left * 100) / 100,
            width: Math.round(linkRect.width * 100) / 100,
          },
          fonts: document.fonts.status,
          animationCount: ul.getAnimations().length,
          url: location.href,
          bodyClass: document.body.className,
          readyState: document.readyState,
        };
      }, label);

    await page.setViewportSize({ width: 1024, height: 900 });
    await page.route(/\.woff2$/, async (route) => {
      await sleep(1_500);
      await route.continue();
    });
    await page.goto(`${base}/fixtures.html`, { waitUntil: "domcontentloaded" });
    const closed = await snapshot("closed");
    await page.locator(".mobile-menu").click();
    const samples = [closed];
    for (const delay of [0, 100, 200, 350, 600, 1200, 2000]) {
      await sleep(delay === 0 ? 0 : delay);
      samples.push(await snapshot(`+${delay}ms`));
    }
    report.drawer = samples;
    for (const sample of samples) {
      console.log(
        `${sample.label.padEnd(8)} ul.left=${String(sample.ul.left).padStart(8)} ul.width=${sample.ul.width} firstLink.left=${sample.firstLink.left} fonts=${sample.fonts} body="${sample.bodyClass}" ready=${sample.readyState} url=${sample.url.split("/").pop()}`,
      );
    }
    throw new Error("__drawer_complete__");
  }

  if (process.argv.includes("--matrix")) {
    /*
     * Before/after movement per width and theme.
     *
     * "after"  = the shipped stack (Open Sans + metric-matched fallback)
     * "before" = the pre-fix stack (Open Sans + system-ui, no matching)
     */
    const PRE_FIX_STACK =
      `'Open Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif !important`;
    const results = [];
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
        for (const variant of ["before", "after"]) {
          await page.unroute(/\.woff2$/).catch(() => {});
          await page.route(/\.woff2$/, async (route) => {
            await sleep(1_500);
            await route.continue();
          });
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${base}/fixtures.html`, { waitUntil: "domcontentloaded" });
          const usesDrawer = width < 1280;
          if (usesDrawer) {
            await page.locator(".mobile-menu").click();
            await sleep(400);
          }
          if (variant === "before") {
            await page.addStyleTag({
              content: `header nav ul li a { font-family: ${PRE_FIX_STACK}; }`,
            });
          }
          const read = () =>
            page.evaluate(() =>
              [...document.querySelectorAll("header nav ul li a")].map((anchor) => {
                const rect = anchor.getBoundingClientRect();
                return { text: anchor.textContent.trim(), left: rect.left, width: rect.width };
              }),
            );
          const before = await read();
          await page.evaluate(() => document.fonts.ready);
          await sleep(300);
          const after = await read();
          const worst = Math.max(
            ...after.map((entry, index) => Math.abs(entry.left - (before[index]?.left ?? entry.left))),
          );
          results.push({
            theme,
            width,
            variant,
            worstMovementPx: Math.round(worst * 100) / 100,
            settled: after.find((entry) => entry.text === "News & Events")?.left ?? null,
          });
          console.log(
            `${theme.padEnd(5)} @ ${width}px  ${variant.padEnd(5)}  worst movement ${Math.round(worst * 100) / 100}px`,
          );
        }
      }
    }
    report.matrix = results;
    throw new Error("__matrix_complete__");
  }

  await page.goto(`${base}/membership.html`, { waitUntil: "domcontentloaded" });

  report.inventories.start = {
    news: await retryEvaluation(inventory, "News"),
    fixtures: await retryEvaluation(inventory, "Fixtures"),
  };

  const plan = ["Fixtures", "News", "Fixtures"];
  for (let index = 0; index < iterations; index += 1) {
    const label = plan[index % plan.length] === "News" ? "News & Events" : "Fixtures";
    const expected = label === "News & Events" ? "news.html" : "fixtures.html";

    const link = await retryEvaluation(visibleDesktopLink, label);
    report.steps.push({ index, label, link: link.chosen ?? link.scored });

    if (!link.chosen) {
      report.failure = {
        kind: "no-visible-desktop-link",
        index,
        label,
        state: await clickPointDiagnostics(label, 0, 0),
      };
      break;
    }

    const before = documentRequests.length;
    await page.mouse.click(link.chosen.hit.x, link.chosen.hit.y);

    // Did a document navigation start?
    const deadline = Date.now() + 4_000;
    let started = documentRequests.length > before;
    while (!started && Date.now() < deadline) {
      await sleep(50);
      started = documentRequests.length > before;
    }

    if (!started) {
      report.failure = {
        kind: "click-did-not-navigate",
        index,
        label,
        expected,
        url: page.url(),
        requestsBefore: before,
        state: await clickPointDiagnostics(label, link.chosen.hit.x, link.chosen.hit.y),
      };
      break;
    }

    // Rapid mode: click again as soon as the destination is parsed, like a
    // user who is clicking through the menu quickly.
    if (mode === "rapid") {
      await page
        .waitForLoadState("domcontentloaded", { timeout: 4_000 })
        .catch(() => {});
    } else {
      await page.waitForLoadState("load", { timeout: 6_000 }).catch(() => {});
      await sleep(250);
    }
  }

  report.inventories.end = {
    news: await retryEvaluation(inventory, "News"),
    fixtures: await retryEvaluation(inventory, "Fixtures"),
  };
} catch (error) {
  if (
    !error.message.startsWith("__") ||
    ![
      "__inventory_complete__",
      "__geometry_complete__",
      "__fontshift_complete__",
      "__repro_complete__",
      "__tune_complete__",
      "__probe_complete__",
      "__drawer_complete__",
      "__matrix_complete__",
    ].includes(error.message)
  ) {
    report.failure = { kind: "exception", message: error.message, stack: error.stack };
  }
} finally {
  report.finishedAt = new Date().toISOString();
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await context.close();
  await browser.close();
  if (server) server.close();
}

console.log(`steps: ${report.steps.length}`);
console.log(`document requests: ${documentRequests.length}`);
if (report.failure) {
  console.log(`FAILURE: ${report.failure.kind} at step ${report.failure.index} (${report.failure.label})`);
  const state = report.failure.state;
  if (state) {
    console.log(`  url=${state.documentState?.url} readyState=${state.documentState?.readyState}`);
    console.log(`  elementFromPoint=${state.elementFromPoint?.node}`);
    console.log(`  anchor=${state.anchor?.node} rect=${JSON.stringify(state.anchor?.rect)}`);
    console.log(`  stack=${(state.elementsFromPoint ?? []).slice(0, 6).map((entry) => entry.node).join(" > ")}`);
    console.log(`  events=${JSON.stringify((state.events ?? []).slice(-8), null, 1)}`);
    console.log(`  prevented=${JSON.stringify(state.prevented ?? [], null, 1)}`);
  }
} else {
  console.log("No failure reproduced.");
}
console.log(`report: ${path.relative(root, reportPath)}`);
