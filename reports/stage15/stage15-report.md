# Stage 15 — Historical Archive Experience & History-page alignment

The archive index was rebuilt as a single-direction editorial chronology. No
historical article copy, date, image or permalink changed; the article pages
themselves were not touched.

## Archive layout, before and after

| | Before | After |
| --- | --- | --- |
| Structure | alternating left/right timeline | one rail, one story column |
| Rail | centre line with cards either side | continuous rail between the year column and the stories |
| Cards | half-width, image 4fr / text 8fr, image centred in a tall row | full-width row, image 3fr / text 8fr, text vertically centred |
| Years | a heading inside every other card | chapter marker beside the rail, once per year |
| Multiple stories in a year | separate alternating cards | listed together under the year |
| Images | small (`sizes` capped at 320px) and could be letterboxed in a tall column | ~1/3 of the row, framed, never cropped |

Root cause of the old look: the Stage 13 editorial CSS for `.timeline*` was
fighting the legacy `.timeline` rules kept for the timeline on `about.html`
(`max-width: 800px`, `li { width: 50% }`, `nth-child(even) { left: 50% }`, a
centred `::after` rail). The archive now uses its own `.archive-*` classes, so
the club-history timeline on `about.html` keeps the legacy rules untouched.

## Historical item count and year grouping

10 items in 9 year chapters: 1911 (two stories), 1914, 1935, 1942, 1961, 1988,
2002, 2003, 2013. `_data/newsArchive.js` sorts `history` by year then `isoDate`
(so 3 June 1911 now precedes 15 July 1911 — a chronology correction, not a
content change) and exposes `historyYears` for the grouping. No second dataset
was created; the archive reads the Stage 13 collection.

## Card design

Year (`<h3>`, right-aligned beside the rail) → one `<ol>` of rows → each row:
`[ image ]` + date · HISTORICAL · title (`<h4>`) · excerpt · "Read the story".
The title carries a stretched link, so the whole row is clickable without
nesting links. Row hover lifts the card by 2px and deepens the shadow — the same
language as the news and fixtures cards.

## Excerpt strategy

Each row shows the article's own front-matter `excerpt` (a sentence-level
extract written for cards and search results), trimmed only to complete
sentences by `tools/news-excerpts.mjs` if it would exceed 240 characters. It
never cuts mid-sentence or mid-word, never adds an ellipsis and never rewords.
Today's longest card excerpt is 248 characters (a single sentence, returned
whole) and the rest are 71–221 characters → two to three lines in the new wide
row. The untrimmed excerpt still feeds each article's meta description.

## Image strategy

Every image is shown whole: the frame is a fixed 3:2 box on desktop (16:10 on
phones) and the `<img>` keeps its own aspect ratio inside it, so nothing is
cropped, stretched or upscaled past its source. Newspaper cuttings (`imageType:
"clipping"` in front matter, 4 of the 10 items — verified by inspecting each
scan) sit on a warm archival panel derived from `--color-brass`; photographs
(6) use the same frame on the plain surface. No colourising, no restoration.

## Mobile behaviour

At ≤820px the year moves above its stories and the rail moves to the left edge
of the container: full-width cards, one card per story, no zig-zag, no
horizontal overflow (measured 0px at 375/768/1024/1440 in both themes). Card
images stay ~340px wide on a 375px viewport.

## History-page cross-links

- `history.html` gains one button after its intro: **Explore the historical
  archive** → `/news/history/`.
- The archive's header band links back: **Read the club history** →
  `/history.html` (alongside the existing "All news" link).
The distinction is unchanged and now stated in MAINTENANCE.md: `history.html` is
the narrative club history, `/news/history/` is the article archive.

## Accessibility

- Years and dates are real text (`<h3>` chapters, `<time datetime>` per story),
  so the chronology survives with CSS and images removed — asserted by a test.
- Anchor order is: eyebrow → title → archive meta → year → story cards.
- axe: 0 violations across 24 capture runs (archive, representative article and
  History page × 1440/1024/768/375 × day/night).
- Header collision probe: 550 checks, 0 problems.

## Tests

`tests/historical-archive.spec.js` (14 tests) covers item count (10), unique
permalinks, chronological order (years ascending, dates ascending), multi-story
year handling, no current-news leakage, compact excerpts (≤260 chars, complete
sentences, prefixes of the article copy), image rendering (loaded, alt text,
aspect ratio preserved, clipping panels marked), years/dates present as text,
cross-links both ways, every article reachable, the single-column tablet/mobile
layout, full-width phone cards, and night-theme rendering.

Updated for the new markup: `tests/news-architecture.spec.js` and
`tests/javascript-interactions.spec.js` (`.archive-item` / `.archive-row-title`
instead of the retired `.timeline-*` classes).

## Results

- Playwright: **305 passed, 199 skipped, 0 failed** (6.1 min).
- HTML validation: 12 findings (7 unique, all pre-existing legacy pages), 0 new,
  39 baseline items resolved.
- Internal links 2,763 checked / 0 missing; images 2,864 checked / 0 broken;
  sitemap 68 URLs = 68 expected; SEO metadata unchanged.

## Archive page weight

| | Before | After |
| --- | --- | --- |
| Requests | 19 | 20 |
| Total transferred | 915 KiB | 939 KiB |
| HTML document | 21 KiB | 27 KiB |
| Images | 290 KiB (9) | 305 KiB (10) |
| Stylesheets (all) | 159 KiB | 163 KiB |
| JavaScript | 11 KiB | 11 KiB |

The archive stays lightweight: +24 KiB total (+2.6%) buys the year chapters,
larger uncropped imagery and the per-row affordances; no JavaScript was added
(the rail is CSS only) and `script.js` is unchanged.

## Visual baselines

Regenerated after review: `news-archive-history-desktop/tablet/mobile/
night-desktop` and `history-desktop/tablet/mobile/night-desktop` (the History
page changed only by the cross-link button). The representative historical
article baselines are unchanged, confirming the article pages were not touched.

## Remaining historical-content debt

- Two historical items still use a photo credit or a single clause as their
  front-matter excerpt source; the card text is short but factual.
- Several scans are low-resolution phone photographs of clippings; they render
  correctly but a future content pass could re-scan them.
- The archive shows the ten items the club has published; older material that
  exists only in the physical archive is out of scope here.

## Housekeeping found while testing

The Stage 13 "trim trailing whitespace" build transform never matched CRLF
output (`[ \t]+$` cannot match when a `\r` precedes the end of line), so every
generated page still carried whitespace-only lines. Fixed with a `\r?`
lookahead: HTML-validation findings fell from 94 occurrences (12 unique + 82
whitespace) to 12 occurrences / 7 unique, and 39 baselined items resolved.
