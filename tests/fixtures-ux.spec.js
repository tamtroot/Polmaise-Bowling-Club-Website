import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createStaticServer } from "../tools/static-server.mjs";
import { writeMeasurement } from "./helpers/baseline.mjs";
import { SITE_ROOT } from "./helpers/site-root.mjs";

/**
 * Stage 14 — the fixtures page across the season.
 *
 * The page state is derived at build time from `_data/fixtures.json`, so the
 * four states a season passes through (early, mid, late, complete) are
 * exercised by building a copy of the site with the build date pinned. The
 * expectations below are worked out here from the raw fixture file rather than
 * from the build helper, so a mistake in that helper cannot hide itself.
 *
 * `FIXTURES_TEST_TODAY` and `SKIP_IMAGE_PIPELINE` are test-only; production
 * builds never set them, and a test below asserts the published pages carry no
 * trace of either.
 */
const projectRoot = process.cwd();
const PORT = 4201;

/**
 * One build directory per state. Playwright runs this file in a single worker,
 * so a state is built once and reused by every test that needs it; separate
 * directories keep a later build from overwriting an earlier state.
 */
const variantRootFor = (key) => path.join(projectRoot, `_site-fixtures-${key}`);

const fixturesFile = JSON.parse(
  readFileSync(path.join(projectRoot, "_data", "fixtures.json"), "utf8"),
);
const SEASON = Number(fixturesFile.season);

const MONTH_NUMBERS = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "04-Apr" (or a range) → { iso, month, day } in the season's year. */
function dateOf(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^\s*(\d{1,2})-([A-Za-z]{3})/);
  if (!match) return null;
  const month = MONTH_NUMBERS[match[2].toLowerCase()];
  if (!month) return null;
  const day = Number(match[1]);
  return {
    iso: `${SEASON}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    day,
    month,
  };
}

const isPlaceholder = (value) => !value || value === "—" || value === "-";

/**
 * The order the page is expected to list fixtures in: by date, ties in file
 * order, and anything without a usable date last (where the club keeps it).
 */
function expectedOrder() {
  return fixturesFile.items
    .map((item, index) => ({ index, date: dateOf(item.date) }))
    .sort((left, right) => {
      if (!left.date) return right.date ? 1 : left.index - right.index;
      if (!right.date) return -1;
      if (left.date.iso === right.date.iso) return left.index - right.index;
      return left.date.iso < right.date.iso ? -1 : 1;
    })
    .map((item) => item.index);
}

/** The dataset classified by the fixtures page's own rules. */
function expectedState(todayIso) {
  const dated = fixturesFile.items.map((item, index) => ({ ...item, index, date: dateOf(item.date) }));
  const usable = dated.filter((item) => item.date && !isPlaceholder(item.competition));

  // Ties keep the club's own order, exactly as the build does.
  const byDate = (left, right) =>
    left.date.iso === right.date.iso
      ? left.index - right.index
      : left.date.iso < right.date.iso
        ? -1
        : 1;

  const ascendingPast = usable.filter((item) => item.date.iso < todayIso).sort(byDate);
  const past = [...ascendingPast].reverse();
  const upcoming = usable.filter((item) => item.date.iso >= todayIso).sort(byDate);

  return {
    total: dated.length,
    past,
    upcoming,
    latestResult: past[0] ?? null,
    nextFixture: upcoming[0] ?? null,
    seasonComplete: upcoming.length === 0,
    // The four most recent completed fixtures stay visible; the rest collapse.
    visiblePast: past.slice(0, 4),
    earlier: ascendingPast.slice(0, Math.max(0, ascendingPast.length - 4)),
    earlierCount: Math.max(0, past.length - 4),
  };
}

/**
 * One build per pinned date: every test that needs a state reuses the copy that
 * was already built for it (Playwright runs this file in a single worker), which
 * keeps the extra site builds to four.
 */
const builtStates = new Set();

/** Build a copy of the site with the build date pinned. */
function buildVariant(todayIso, fixturesPath = null) {
  const key = todayIso ?? "synthetic";
  const outputRoot = variantRootFor(key);
  if (builtStates.has(key)) {
    return outputRoot;
  }

  execFileSync(process.execPath, ["tools/build-site.mjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      SITE_ROOT: path.relative(projectRoot, outputRoot),
      IMAGE_CACHE_ROOT: process.env.IMAGE_CACHE_ROOT ?? path.join(".cache-alt", "images"),
      ...(todayIso ? { FIXTURES_TEST_TODAY: todayIso } : {}),
      ...(fixturesPath ? { FIXTURES_TEST_DATA: fixturesPath } : {}),
      SKIP_IMAGE_PIPELINE: "true",
    },
    stdio: "pipe",
    timeout: 240_000,
  });
  builtStates.add(key);
  return outputRoot;
}

/** Serve the variant build for the browser-side assertions. */
async function withVariant(todayIso, run) {
  const root = buildVariant(todayIso);
  const server = createStaticServer(root);
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${PORT}`, expectedState(todayIso));
  } finally {
    server.close();
  }
}

const STATES = [
  { name: "early season", today: `${SEASON}-04-01` },
  { name: "mid season", today: `${SEASON}-06-20` },
  { name: "late season", today: `${SEASON}-09-10` },
  { name: "season complete", today: `${SEASON}-10-01` },
];

test.describe("fixture state through the season", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1280, "Build checks run once on desktop");

  test.setTimeout(300_000);

  for (const state of STATES) {
    test(`${state.name} renders the right next fixture, latest result and split`, async ({
      page,
    }) => {
      await withVariant(state.today, async (baseUrl, expected) => {
        await page.goto(`${baseUrl}/fixtures.html`, { waitUntil: "domcontentloaded" });

        // --- summary strip -------------------------------------------------
        const latestCard = page.locator(".fixtures-summary-card").first();
        if (expected.latestResult) {
          await expect(latestCard.locator(".fixtures-summary-value")).toHaveText(
            expected.latestResult.competition,
          );
        } else {
          await expect(latestCard.locator(".fixtures-summary-value")).toHaveText(
            /No matches played yet/,
          );
        }

        const nextCard = page.locator(".fixtures-summary-card").nth(1);
        if (expected.nextFixture) {
          await expect(nextCard.locator(".fixtures-summary-value")).toHaveText(
            expected.nextFixture.competition,
          );
          await expect(nextCard.locator(".fixtures-summary-detail")).toContainText(
            expected.nextFixture.day,
          );
          await expect(nextCard.locator(".fixtures-summary-note")).toHaveText(
            expected.nextFixture.status,
          );
        } else {
          await expect(nextCard.locator(".fixtures-summary-value")).toHaveText("Season complete");
          await expect(nextCard.locator(".fixtures-summary-detail")).toContainText(
            "no more scheduled fixtures",
          );
        }

        const statusCard = page.locator(".fixtures-summary-card").nth(2);
        await expect(statusCard.locator(".fixtures-summary-value")).toHaveText(
          expected.seasonComplete ? "Season complete" : "Season in progress",
        );
        await expect(statusCard.locator(".fixtures-summary-detail")).toContainText(
          `${expected.past.length} played · ${expected.upcoming.length} to play`,
        );

        // --- one row and one card per fixture, none lost, none duplicated ---
        const rowIndexes = await page
          .locator(".fixtures-table tbody tr[data-fixture]")
          .evaluateAll((rows) => rows.map((row) => Number(row.dataset.fixture)));
        const cardIndexes = await page
          .locator(".fixtures-table-mobile .fixture-card[data-fixture]")
          .evaluateAll((cards) => cards.map((card) => Number(card.dataset.fixture)));
        const allIndexes = fixturesFile.items.map((item, index) => index);
        const listedOrder = expectedOrder();

        expect(rowIndexes).toEqual(listedOrder);
        expect(cardIndexes).toEqual(listedOrder);
        // Every fixture is published exactly once in each layout.
        expect(new Set(rowIndexes).size).toBe(expected.total);
        expect([...rowIndexes].sort((left, right) => left - right)).toEqual(allIndexes);

        // --- the season splits exactly where the data says it does ----------
        const pastRowIndexes = await page
          .locator(".fixtures-table tbody tr.past-fixture[data-fixture]")
          .evaluateAll((rows) => rows.map((row) => Number(row.dataset.fixture)));
        // The table reads oldest → newest, so the completed fixtures appear in
        // the reverse of the "latest result first" list.
        expect(pastRowIndexes).toEqual([...expected.past].reverse().map((item) => item.index));

        const nextRows = page.locator(".fixtures-table tbody tr.next-fixture[data-fixture]");
        const nextCards = page.locator(".fixtures-table-mobile .fixture-card.next-fixture[data-fixture]");
        await expect(nextRows).toHaveCount(expected.nextFixture ? 1 : 0);
        await expect(nextCards).toHaveCount(expected.nextFixture ? 1 : 0);
        if (expected.nextFixture) {
          await expect(nextRows).toHaveAttribute("data-fixture", String(expected.nextFixture.index));
          await expect(nextRows.locator(".fixture-flag")).toHaveText("Next");
        }

        // Upcoming fixtures are listed next to each other in ascending order.
        const upcomingRowIndexes = await page
          .locator(
            '.fixtures-table tbody tr[data-fixture-state="today"], .fixtures-table tbody tr[data-fixture-state="future"]',
          )
          .evaluateAll((rows) => rows.map((row) => Number(row.dataset.fixture)));
        expect(upcomingRowIndexes).toEqual(expected.upcoming.map((item) => item.index));

        // --- month grouping ------------------------------------------------
        const monthLabels = await page
          .locator(".fixtures-table tbody tr.fixtures-month-row th")
          .evaluateAll((cells) => cells.map((cell) => cell.textContent.trim()));
        const expectedMonths = [
          ...new Set(
            fixturesFile.items
              .map((item) => dateOf(item.date))
              .filter(Boolean)
              .map((date) => `${MONTH_NAMES[date.month - 1]} ${SEASON}`),
          ),
        ];
        expect(monthLabels).toEqual(expectedMonths);

        // --- the season stays complete in the document ---------------------
        const olderRows = await page
          .locator(".fixtures-table tbody tr[data-fixture][data-fixtures-older]")
          .count();
        const olderCards = await page
          .locator(".fixtures-table-mobile .fixture-card[data-fixtures-older]")
          .count();
        expect(olderRows).toBe(expected.earlierCount);
        expect(olderCards).toBe(expected.earlierCount);

        // Every collapsed fixture is the start of the season, and the month
        // labels that belong to those months collapse with them.
        const collapsedIndexes = await page
          .locator(".fixtures-table tbody tr[data-fixture][data-fixtures-older]")
          .evaluateAll((rows) => rows.map((row) => Number(row.dataset.fixture)));
        expect(collapsedIndexes).toEqual(expected.earlier.map((item) => item.index));
      });
    });
  }
});

test.describe("fixture collapse control", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1280, "Build checks run once on desktop");

  test.setTimeout(300_000);

  test("hides the earlier fixtures, then reveals them for mouse and keyboard users", async ({
    page,
  }) => {
    await withVariant(`${SEASON}-06-20`, async (baseUrl, expected) => {
      await page.goto(`${baseUrl}/fixtures.html`, { waitUntil: "domcontentloaded" });

      const table = page.locator("#fixtures-table");
      const toggle = page.locator(".fixtures-control-row [data-fixtures-toggle]");

      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(toggle).toContainText("Show earlier fixtures");
      await expect(toggle).toContainText(`(${expected.earlierCount})`);
      await expect(toggle).toHaveAttribute("aria-controls", /fixtures-table/);

      const firstOlder = table.locator("tr[data-fixture][data-fixtures-older]").first();
      await expect(firstOlder).toBeHidden();
      await expect(
        table.locator("tr[data-fixture]:not([data-fixtures-older])").first(),
      ).toBeVisible();

      // Mouse: reveal, then put back.
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(toggle).toContainText("Hide earlier fixtures");
      await expect(firstOlder).toBeVisible();
      await expect(table.locator("tr[data-fixture][data-fixtures-older]")).toHaveCount(
        expected.earlierCount,
      );
      // Months that belong entirely to the collapsed part hide with their rows.
      await expect(table.locator("tr.fixtures-month-row[data-fixtures-older]")).not.toHaveCount(0);

      await toggle.click();
      await expect(firstOlder).toBeHidden();

      // Keyboard: focus the control and activate it with the keyboard.
      await toggle.focus();
      await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(firstOlder).toBeVisible();
      await page.keyboard.press("Space");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(firstOlder).toBeHidden();

      // The mobile control mirrors the same state.
      const mobileToggle = page.locator(".fixtures-table-mobile [data-fixtures-toggle]");
      await expect(mobileToggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();
      await expect(mobileToggle).toHaveAttribute("aria-expanded", "true");
    });
  });

  test("keeps every fixture visible when JavaScript is unavailable", async ({ browser }) => {
    const root = buildVariant(`${SEASON}-06-20`);
    const server = createStaticServer(root);
    await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

    try {
      const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${PORT}/fixtures.html`, { waitUntil: "domcontentloaded" });

      // Nothing is collapsed without JavaScript and the control is not offered,
      // so no fixture can be stranded behind a dead button.
      await expect(page.locator(".fixtures-table tbody tr[data-fixture]:visible")).toHaveCount(
        fixturesFile.items.length,
      );
      await expect(page.locator(".fixtures-table tbody tr[data-fixtures-older]:visible")).not.toHaveCount(0);
      await expect(page.locator("[data-fixtures-toggle]:visible")).toHaveCount(0);

      await context.close();
    } finally {
      server.close();
    }
  });
});

test.describe("fixtures page on a small screen and in the night theme", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1280, "Build checks run once");

  test.setTimeout(300_000);

  test("uses the card layout, keeps the next fixture in view and never scrolls sideways", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile checks run in the mobile project");

    await withVariant(`${SEASON}-06-20`, async (baseUrl, expected) => {
      await page.goto(`${baseUrl}/fixtures.html`, { waitUntil: "domcontentloaded" });

      await expect(page.locator(".fixtures-table")).toBeHidden();
      await expect(page.locator(".fixtures-table-mobile")).toBeVisible();

      const nextCard = page.locator(".fixtures-table-mobile .fixture-card.next-fixture");
      await expect(nextCard).toHaveCount(1);
      await expect(nextCard).toContainText(expected.nextFixture.competition);
      await expect(nextCard).toContainText(expected.nextFixture.venue);
      await expect(nextCard.locator(".fixture-flag")).toHaveText("Next");

      // The collapsed list must still show the current point of the season.
      await expect(nextCard).toBeVisible();
      await expect(page.locator(".fixtures-table-mobile .fixture-card:visible").first()).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    });
  });

  test("renders in the night theme without console errors", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Night capture runs on desktop");

    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("polmaise-theme", "dark");
      } catch (error) {
        /* storage unavailable */
      }
    });

    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await withVariant(`${SEASON}-06-20`, async (baseUrl) => {
      await page.goto(`${baseUrl}/fixtures.html`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(page.locator(".fixtures-summary-card").first()).toBeVisible();
      await expect(page.locator(".fixtures-table tbody tr.next-fixture")).toBeVisible();
      expect(consoleErrors).toEqual([]);
    });
  });
});

test("synthetic fixture state cannot reach the published site", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Leak check runs once");

  const productionHtml = readFileSync(path.join(SITE_ROOT, "fixtures.html"), "utf8");
  expect(productionHtml).not.toContain('data-test-fixtures="true"');
  expect(productionHtml).not.toContain("Stage 14 synthetic");

  const homepageHtml = readFileSync(path.join(SITE_ROOT, "index.html"), "utf8");
  expect(homepageHtml).not.toContain('data-test-fixtures="true"');
});

test.describe("a fixture list the real season cannot show", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1280, "Build checks run once on desktop");

  test.setTimeout(300_000);

  test("honours a supplied fixture file, including its season", async ({ page }) => {
    const directory = await mkdtemp(path.join(tmpdir(), "polmaise-fixtures-"));
    const fixtureFile = path.join(directory, "fixtures.json");
    const synthetic = {
      season: 2027,
      items: [
        {
          date: "03-Apr",
          competition: "Stage 14 synthetic opener",
          day: "Saturday",
          venue: "Polmaise",
          status: "Confirmed",
        },
        {
          date: "17-Apr",
          competition: "Stage 14 synthetic away trip",
          day: "Saturday",
          venue: "Menstrie",
          status: "TBC",
        },
      ],
    };
    await writeFile(fixtureFile, `${JSON.stringify(synthetic, null, 2)}\n`, "utf8");

    try {
      const root = buildVariant(null, fixtureFile);
      const server = createStaticServer(root);
      await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

      try {
        await page.goto(`http://127.0.0.1:${PORT}/fixtures.html`, { waitUntil: "domcontentloaded" });

        // The season comes from the data, never from the calendar or a hard-coded year.
        await expect(page.locator("#fixtures-title")).toHaveText("2027 Fixtures");
        await expect(page.locator(".fixtures-table tbody tr[data-fixture]")).toHaveCount(2);
        await expect(page.locator(".fixtures-summary-card").nth(1).locator(".fixtures-summary-value")).toHaveText(
          "Stage 14 synthetic opener",
        );
        await expect(page.locator(".fixtures-table tbody tr.next-fixture")).toHaveCount(1);

        // The build is marked as test-driven so the leak check above can prove
        // it never reaches the published site.
        await expect(page.locator(".fixtures-section")).toHaveAttribute("data-test-fixtures", "true");
      } finally {
        server.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

test.afterAll(async () => {
  for (const key of [...STATES.map((state) => state.today), "synthetic"]) {
    await rm(variantRootFor(key), { recursive: true, force: true });
  }
});

test("records the fixture inventory for the stage report", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Measurement runs once");

  await writeMeasurement("fixtures", {
    season: SEASON,
    fixtures: fixturesFile.items.length,
    confirmed: fixturesFile.items.filter((item) => item.status === "Confirmed").length,
    tbc: fixturesFile.items.filter((item) => item.status === "TBC").length,
    proposed: fixturesFile.items.filter((item) => item.status === "Proposed").length,
    visiblePastFixtures: 4,
    statesCovered: STATES.map((state) => state.name),
  });
});
