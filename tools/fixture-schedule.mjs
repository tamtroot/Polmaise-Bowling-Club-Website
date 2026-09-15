/**
 * Stage 14 — pure fixture-date helpers.
 *
 * These live outside `_data/` because Eleventy only treats a data file's
 * default export as data when the module has no other exports (a module with
 * named exports is published as its namespace). `_data/fixtureSchedule.js` and
 * `_data/homepage.js` both build on these, so the homepage and the fixture list
 * can never disagree about which fixtures are past, today or still to come.
 *
 * Dates in the club's list are day-month ("04-Apr", ranges as
 * "08-Aug to 15-Aug"), so the season year is applied here. Everything is
 * calculated in UTC from date-only values, so a build never drifts by a day
 * because of the machine's timezone.
 */
export const MONTHS = [
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

const MONTH_INDEX = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "—" (and the odd dash) marks a placeholder cell in the club's list. */
export const isPlaceholder = (value) =>
  !value || value === "—" || value === "-" || value === "–";

/**
 * Fixture dates are written for people, not machines: "04-Apr" or a range such
 * as "08-Aug to 15-Aug". Returns a UTC date at midnight, or null when the value
 * carries no usable date.
 */
export function parseFixtureDate(value, season) {
  if (typeof value !== "string") return null;
  const match = value.match(/^\s*(\d{1,2})-([A-Za-z]{3})/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = MONTH_INDEX[match[2].toLowerCase()];
  if (!Number.isFinite(day) || month === undefined) return null;

  const date = new Date(Date.UTC(season, month, day));
  // Reject overflow ("31-Feb" rolls into March) rather than publishing it.
  return date.getUTCDate() === day && date.getUTCMonth() === month ? date : null;
}

export const toIsoDate = (date) => date.toISOString().slice(0, 10);

export const formatFixtureDate = (date) =>
  `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;

export const formatFixtureDay = (date, fallback) => DAY_NAMES[date.getUTCDay()] ?? fallback ?? "";

/**
 * Build-time "today".
 *
 * A build is a snapshot, so the fixture pages describe the day they were
 * published — the same rule the list has always used, just moved off the
 * visitor's browser so every visitor (and search engine) sees the same state.
 * `FIXTURES_TEST_TODAY` pins it for the regression tests; production builds
 * never set it.
 */
export function buildToday(now = new Date()) {
  const override = process.env.FIXTURES_TEST_TODAY;
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) {
    const [year, month, day] = override.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Home / away is read from the venue the club already publishes: "Polmaise" is
 * home, anything with a club name is away, and the neutral entries (Various,
 * Home & Away, TBC, "—") stay unlabelled rather than guessed.
 */
export function venueSide(venue) {
  if (isPlaceholder(venue)) return null;
  const normalised = String(venue).trim().toLowerCase();
  if (normalised === "polmaise") return "Home";
  if (["various", "home & away", "tbc", "tba", "to be confirmed"].includes(normalised)) return null;
  return "Away";
}

/** How many completed fixtures stay visible before "Show earlier fixtures". */
export const VISIBLE_PAST_FIXTURES = 4;
