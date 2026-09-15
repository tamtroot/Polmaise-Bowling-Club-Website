# Stage 14 — Fixtures & Results UX Enhancements

The fixture dataset, the public URL, the desktop table, the mobile cards and the
printable download are all unchanged in structure. What changed is *where the
page opens* and what it tells a member first.

## Fixture-state architecture

- `_data/fixtures.json` is untouched: `season` plus one record per fixture
  (`date`, `competition`, `day`, `venue`, `status`).
- `tools/fixture-schedule.mjs` holds the pure date helpers (parsing `04-Apr`
  and ranges, the build day, venue → Home/Away, date formatting). They are
  shared with `_data/homepage.js`, so the homepage and the fixture list can
  never disagree about what is next.
- `_data/fixtureSchedule.js` classifies every fixture at build time:

| State | Rule |
| --- | --- |
| `past` | usable date before the build day |
| `today` | usable date equal to the build day |
| `future` | usable date after the build day |
| `unknown` | no usable date, or a placeholder competition (`—`) |

From that it derives `nextFixture`, `latestResult`, the upcoming list
(ascending), completed fixtures (most recent first), month groups, the four most
recent completed fixtures that stay visible, and the collapsed remainder. The
page does **no** date arithmetic in the browser: the old `new Date()` script
(which also hard-coded `2026`) is gone, so every visitor and search engine sees
the same state.

## Current-season UX

1. **Season summary strip** — Latest result · Next fixture (or the
   season-complete state) · Season status (`17 played · 32 to play · 50
   fixtures listed`).
2. **Full season** — the same table members know (Date · Club/Competition · Day
   · Venue · Confirmed), still in season order, now with month bands, "Past
   fixtures" / "Upcoming fixtures" labels, the next fixture highlighted and
   flagged `Next`, and month-relative striping.
3. The page opens at the current point of the season because the earlier
   completed fixtures are collapsed (four most recent stay visible).

## Latest result

The most recent completed fixture, with its day, date, venue and a neutral note
that the result is not recorded in the fixture list, plus a link to club news.
The fixture dataset has no result field, so **no score is shown or inferred**
anywhere; the brief's "Result not recorded" state is used rather than inventing
or assuming a win/loss/draw. With no completed fixtures yet the card reads
"No matches played yet" and names the opening date.

## Next fixture

The first upcoming fixture, with day, date, Home/Away, venue and status badge.
When the season is complete the card shows "Season complete" and "There are no
more scheduled fixtures this season. The new season fixture list will appear
here when confirmed." — with no hard-coded year (it comes from `season`).

## Past fixtures

Kept in the season order, marked as past, and split into the four most recent
(always visible) and everything earlier. The earlier ones stay in the generated
HTML and are revealed by a native button ("Show earlier fixtures (45)" →
"Hide earlier fixtures") with `aria-expanded` and `aria-controls`, mirrored in
the mobile card list. Without JavaScript nothing is collapsed and the control is
hidden (`.js` class from the head script), so the season is readable either way
and no fixture can be stranded behind a dead button.

## Month grouping

Month rows (`<th colspan="5" scope="colgroup">`) inside the table and matching
`<h4>` headings in the mobile card list, both ascending. Months that belong
entirely to the collapsed part hide with their rows, so no orphan heading is
left behind.

## Full-season behaviour

All 50 fixtures are rendered exactly once per layout. Expanding the control
shows the complete chronological season; the printable download is now pointed
at the 2026 PDF that already existed in `downloads/` (it previously linked the
2025 file while the copy claimed the 2025 season) with the 2025 list kept as a
secondary link.

## Calendar support — deferred

Investigated and deliberately **not** implemented: the data carries dates and a
status only, with no kick-off times, and six fixtures are `TBC` and one
`Proposed`, so generated `.ics` events would be misleading. Documented in
MAINTENANCE.md with the trigger for revisiting it (times added to the data).

## Filtering — deferred

Assessed and deferred: with the summary strip, month groups and collapsed
completed fixtures, the page is already short at 50 fixtures, and a filter would
add JavaScript for little gain. Recorded in the backlog with the other deferred
items.

## Mobile behaviour (375 px)

Card layout (as before) with month headings, the next fixture flagged and
highlighted, Home/Away tags, a full-width collapse control and no horizontal
overflow (measured 0 px at 375/768/1024/1440, day and night, collapsed and
expanded).

## Day / night

No new colours: the summary cards, month bands, group labels, home/away tags and
control all use existing semantic tokens, so night uses the graphite/light-blue
hierarchy automatically. Capture tool runs axe over both themes.

## Tests added

`tests/fixtures-ux.spec.js` (11 tests) covers the four season states (early,
mid, late, complete) plus:

- next-fixture and latest-result selection, past/future split and counts;
- upcoming ascending / season-order listing, no duplication, no omission;
- month grouping and label order;
- collapsed versus expanded visibility and the counts hidden;
- keyboard operation (Enter and Space) and `aria-expanded` sync across both
  layouts;
- the no-JavaScript fallback (everything visible, control hidden);
- mobile card layout, next fixture visible, no sideways scroll;
- night-theme rendering with no console errors;
- a supplied fixture file (season 2027) proving the season/year and override
  path, plus the leak check that no test-driven state reaches `_site`;
- the recorded fixture inventory measurement.

The expectations are recomputed from `_data/fixtures.json` in the spec (own date
parser), so the build helper cannot hide its own mistakes. States are built with
`FIXTURES_TEST_TODAY` and one build directory per state.

Updated for the new architecture: `tests/javascript-interactions.spec.js`
(state is in the markup now), `tests/theme.spec.js` (first *visible* card),
`tests/build-output.spec.js` (fixtures page exempted from the Stage 2A DOM
comparison, with a new guard that no nested `_site*` directory is published).

## Regression results

- Playwright: **291 passed, 174 skipped, 0 failed** (5.2 min).
- axe: page-audit spec (desktop, day) 0 violations; capture tool 32 runs
  (season-complete and mid-season × 4 widths × day/night × collapsed/expanded)
  0 violations.
- Header collision probe: 550 checks, 0 problems.
- HTML validation: baseline unchanged (one new finding — `<th>` scope — was
  fixed by adding `scope="col"` to the table head, so the baseline stays clean).
- Links/images/SEO/sitemap: unchanged and green.

## Visual baselines

Regenerated after review: `fixtures-desktop`, `fixtures-tablet`,
`fixtures-mobile`, `fixtures-night-desktop`. No unrelated baseline changed.
Review captures (all states, both themes, screen shots + JSON) are written by
`tools/capture-stage14-visuals.mjs` to `reports/stage14/visual-review-*.json`.

## Page weight

| | Before (HEAD) | After |
| --- | --- | --- |
| Requests | 11 | 11 |
| Total transferred | 678 KiB | 716 KiB |
| HTML document | 82 KiB | 108 KiB |
| `script.js` on disk | 9,589 B | 11,051 B |

The document grows because it now carries the season summary, month/group
labels, semantic `<time datetime>` dates and Home/Away tags for 50 fixtures in
both layouts; the old 4 KB inline date-classification script was removed, and
shared `styles.css` is unchanged by this stage.

## Bug found and fixed while testing (build hygiene)

Eleventy's input is the project root and it only ignored the literal `_site`
directory. Every other generated root (`_site-alt`, `_site-verify`,
`_site-fixtures-*`, the Stage 12 variant) was therefore re-processed as source:
builds wrote ~2× the pages, published nested copies of sibling builds, and got
progressively slower (one build ran for 11 minutes). The config now ignores
`_site*/**`, and `tests/build-output.spec.js` fails if any `_site*` directory
appears inside the published output.

## Remaining fixture UX debt

- No kick-off times in the data: a time column and calendar export both depend
  on the club supplying them.
- The printable PDF path is still literal in `fixtures.html`; it could move into
  `_data/site.json` alongside the other downloads.
- Results are not part of the fixture dataset, so the page can only point at
  club news; storing a score/result per completed fixture would let the summary
  show a real latest result.
- Filtering stays deferred (see backlog).

## Backlog

Added to MAINTENANCE.md: historical archive presentation
(`/news/history/`) needs a later visual/content refinement pass of its own, plus
the deferred calendar export and fixture filtering.
