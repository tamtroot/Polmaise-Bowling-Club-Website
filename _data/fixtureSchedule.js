import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  MONTHS,
  VISIBLE_PAST_FIXTURES,
  buildToday,
  formatFixtureDate,
  formatFixtureDay,
  isPlaceholder,
  parseFixtureDate,
  toIsoDate,
  venueSide,
} from "../tools/fixture-schedule.mjs";

/**
 * Stage 14 — the single source of truth for fixture state.
 *
 * `_data/fixtures.json` stays the club's editable list (date, competition, day,
 * venue, status). Everything derived from it — which fixtures are past, today or
 * upcoming, which one is next, which is the latest completed fixture and how the
 * list groups by month — is worked out here at build time. Templates only
 * render, so the page state is identical for every visitor and for search
 * engines, and it is identical to the state the homepage shows.
 *
 * The date arithmetic itself lives in `tools/fixture-schedule.mjs`: this file
 * must export nothing but its default value, because Eleventy publishes a data
 * module with named exports as its namespace rather than as usable data.
 */
const projectRoot = process.cwd();

function readFixturesFile() {
  /*
   * Test-only override, mirroring STAGE12_TEST_FIXTURES on the homepage: point
   * the build at a small synthetic list to exercise states the real season
   * cannot show on the day the suite runs. Production builds never set it.
   */
  const override = process.env.FIXTURES_TEST_DATA;
  if (override && existsSync(override)) {
    return { data: JSON.parse(readFileSync(override, "utf8")), testFixtures: true };
  }
  return {
    data: JSON.parse(readFileSync(path.join(projectRoot, "_data", "fixtures.json"), "utf8")),
    testFixtures: false,
  };
}

/** Group an ordered list into consecutive months. */
function byMonth(items) {
  const groups = [];
  for (const item of items) {
    const key = `${item.dateValue.getUTCFullYear()}-${String(item.dateValue.getUTCMonth() + 1).padStart(2, "0")}`;
    const current = groups.at(-1);
    if (current?.key === key) {
      current.items.push(item);
      continue;
    }
    groups.push({
      key,
      label: `${MONTHS[item.dateValue.getUTCMonth()]} ${item.dateValue.getUTCFullYear()}`,
      items: [item],
    });
  }
  return groups;
}

export default function fixtureSchedule() {
  const { data, testFixtures } = readFixturesFile();
  const season = Number(data.season) || new Date().getUTCFullYear();
  const today = buildToday();
  // A pinned build date is test-driven too, so the page can be checked for
  // leaking synthetic state just like a synthetic fixture list can.
  const testDriven = testFixtures || Boolean(process.env.FIXTURES_TEST_TODAY);

  const items = (data.items ?? []).map((item, index) => {
    const dateValue = parseFixtureDate(item.date, season);
    const state =
      !dateValue || isPlaceholder(item.competition)
        ? "unknown"
        : dateValue < today
          ? "past"
          : dateValue.getTime() === today.getTime()
            ? "today"
            : "future";

    return {
      ...item,
      index,
      dateValue,
      isoDate: dateValue ? toIsoDate(dateValue) : "",
      displayDate: dateValue ? formatFixtureDate(dateValue) : item.date,
      dayName: dateValue ? formatFixtureDay(dateValue, item.day) : item.day,
      monthLabel: dateValue ? `${MONTHS[dateValue.getUTCMonth()]} ${dateValue.getUTCFullYear()}` : "",
      side: venueSide(item.venue),
      state,
    };
  });

  const past = items
    .filter((item) => item.state === "past")
    .sort((left, right) => right.dateValue - left.dateValue);
  const upcoming = items
    .filter((item) => item.state === "today" || item.state === "future")
    .sort((left, right) => left.dateValue - right.dateValue);
  const undated = items.filter((item) => item.state === "unknown");

  /*
   * The page lists fixtures in date order (the club's list is nearly in order
   * already; a mis-typed month should not push a row into the wrong month).
   * Ties keep the order they appear in the file, and rows without a usable date
   * stay at the end, where the club put them.
   */
  const ordered = [...items].sort((left, right) => {
    if (!left.dateValue) return right.dateValue ? 1 : left.index - right.index;
    if (!right.dateValue) return -1;
    const difference = left.dateValue - right.dateValue;
    return difference !== 0 ? difference : left.index - right.index;
  });

  const nextFixture = upcoming.find((item) => !isPlaceholder(item.competition)) ?? null;
  const latestResult = past.find((item) => !isPlaceholder(item.competition)) ?? null;

  /*
   * The table keeps the club's season order (April → September). The completed
   * fixtures are split into the few most recent — always visible, so the page
   * still shows where the season has got to — and everything earlier, which the
   * page collapses behind one button. Nothing is removed: the earlier fixtures
   * are in the HTML, and one click (or no JavaScript at all) reveals them.
   */
  const chronologicalPast = [...past].reverse();
  const recentPast = chronologicalPast.slice(-VISIBLE_PAST_FIXTURES);
  const recentPastIndexes = new Set(recentPast.map((item) => item.index));
  const earlierPast = items.filter(
    (item) => item.state === "past" && !recentPastIndexes.has(item.index),
  );
  const earlierPastIndexes = new Set(earlierPast.map((item) => item.index));

  /*
   * Flags the templates read directly, so no template does date arithmetic.
   */
  const upcomingStartIndex = upcoming.length ? upcoming[0].index : -1;
  const nextFixtureIndex = nextFixture ? nextFixture.index : -1;
  const flagged = ordered.map((item) => ({
    ...item,
    isEarlier: earlierPastIndexes.has(item.index),
    isNextFixture: item.index === nextFixtureIndex,
    startsUpcoming: item.index === upcomingStartIndex,
  }));

  return {
    season,
    testFixtures: testDriven,
    today: toIsoDate(today),
    todayLabel: `${formatFixtureDay(today)} ${formatFixtureDate(today)}`,
    /** Every fixture, in the club's season order, for the full-season table. */
    all: flagged,
    past,
    upcoming,
    undated,
    nextFixture,
    latestResult,
    seasonComplete: upcoming.length === 0,
    upcomingStartIndex,
    nextFixtureIndex,
    firstFixture: upcoming[0] ?? items.find((item) => item.dateValue) ?? null,
    visiblePastFixtures: VISIBLE_PAST_FIXTURES,
    earlierPastCount: earlierPast.length,
    months: byMonth(flagged).map((group) => ({
      ...group,
      // A month heading hides with the rows it introduces when all of them are
      // collapsed, so the collapsed list never shows an orphan heading.
      allEarlier: group.items.every((item) => item.isEarlier),
    })),
    counts: {
      total: items.length,
      past: past.length,
      upcoming: upcoming.length,
      undated: undated.length,
      confirmed: items.filter((item) => item.status === "Confirmed").length,
      tbc: items.filter((item) => item.status === "TBC").length,
      proposed: items.filter((item) => item.status === "Proposed").length,
    },
  };
}
