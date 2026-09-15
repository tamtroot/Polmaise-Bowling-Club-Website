/**
 * Stage 13 — one date style for every news surface.
 *
 * The migrated articles carried the wording the old single page used, which
 * mixed "September 5, 2026", "29th July 2025", "June 3, 1911" and, on the
 * article pages, a raw JavaScript `Date` object. Everything user-facing is now
 * derived from the article's ISO date so the display string cannot drift from
 * the machine-readable `<time datetime="...">` value.
 *
 * `formatNewsDate("2026-09-05")` → "5 September 2026"
 *
 * Values that are not ISO dates are returned unchanged, which keeps a future
 * hand-written value such as "Spring 2026" usable.
 */
const MONTHS = [
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

export function formatNewsDate(value) {
  if (value === null || value === undefined) return "";

  const raw = String(value).trim();
  if (!raw) return "";

  const isoTimestamp = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (!isoTimestamp) return raw;

  const [, year, month, day] = isoTimestamp;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return raw;

  return `${Number(day)} ${monthName} ${year}`;
}

/** The machine-readable form used by `<time datetime="...">`. */
export function isoDateValue(value) {
  if (value === null || value === undefined) return "";
  const match = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : String(value).trim();
}
