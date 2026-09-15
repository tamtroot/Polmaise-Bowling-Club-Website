# Stage 13 — correction and completion pass

This pass finishes Stage 13 (News & Historical Archive architecture). The
generated article collection, year archives, category pages, historical archive
and homepage automation were kept; the landing page, article pages and their
test/QA coverage were completed.

## Content inventory

| Measure | Count |
| --- | --- |
| Current news articles | 33 (12 in 2026, 21 in 2025) |
| Historical archive items | 10 (1911–2013) |
| Generated news pages | 51 (43 articles, 2 year archives, 4 category pages, 1 historical index, 1 landing page) |
| Landing page article cards | 33 (1 featured + 3 "Latest from Polmaise" + 29 "More news") |
| Category counts | Competition 10, Tournament 8, Community 2, Club 13 (33 total) |
| Archive counts | 2026 → 12 stories, 2025 → 21 stories, historical → 10 items |

Every current story is reachable from the landing page without opening an
archive first, and every category group corresponds to real article metadata
(`CATEGORY_GROUPS` in `_data/newsArchive.js` now maps `Club Achievement` and
`Media Coverage` into the Club group, so the category counts add up to 33).

## What changed in this pass

### Landing page (`news.html`)

- Editorial front page: featured story → **Latest from Polmaise** (3 medium
  cards) → **More news** (compact two-column list of the remaining 29) →
  **By category** → **Browse the archives**.
- Composition comes from `newsArchive.featured/latest/more`; nothing is
  hand-curated and the featured story is never repeated in the lists.
- The featured excerpt is the article's own front-matter excerpt (sentence
  level), so it no longer ends mid-word.

### Article pages (`_includes/news-article.njk`)

- The title block is in normal document flow above the hero: eyebrow → title →
  date/category → hero → body. No floating panel, no sticky title.
- The duplicated standfirst was removed (the migrated excerpt is the article's
  opening sentence, so it printed twice).
- Header measure matches the body measure (68ch) so the headline sits directly
  above the text column.
- Previous/next navigation now comes from `newsArchive` (newest first) instead
  of the Eleventy collection, so the labels are correct and the one undated
  announcement stays at the end. It stacks at ≤620px.
- Generated news pages now declare the shared page defaults
  (`scriptJs`, `headVariant`, `mobileMenuIcon`, `facebookLink`, …). Without them
  the article pages had **no `script.js`** — no mobile menu, no theme toggle and
  no image lightbox — and an icon-less burger button.

### Dates

- One human-readable style, derived from the ISO date by `tools/news-dates.mjs`:
  `2026-09-05` → "5 September 2026", `1911-06-03` → "3 June 1911".
- `displayDate` / `historicalDate` were removed from all 43 article files (they
  carried four different styles and could drift from the ISO date); `<time
  datetime="YYYY-MM-DD">` is preserved.
- The old rendering bug ("SAT SEP 05 2026 01:00:00 GMT+0100") came from printing
  a JavaScript `Date`; article front matter now quotes `date`/`isoDate` and no
  page interpolates a raw date object.

### Document titles

- `tools/document-titles.mjs` keeps every `<title>` inside html-validate's
  70-character budget (site-name suffix dropped first, then word-boundary
  ellipsis) and the browser tab, Open Graph, Twitter and JSON-LD headline all
  use the same string. Headlines on the page are unchanged.

### Markup and links in the migrated bodies

- `tools/normalise-news-markup.mjs` re-renders each body through an HTML parser.
  All 43 bodies left a `<div>` unclosed, which is why the article navigation was
  being parsed *inside* `.article-body`; the round trip also turns implicit
  closes into explicit ones and escapes raw `&`. Visible text is compared before
  writing and never changes.
- Article bodies are HTML, so they are rendered with
  `templateEngineOverride: "njk"`. Markdown was wrapping stray text in its own
  paragraphs (103 "implicitly closed" findings).
- Links written for a root-level page (`gallery.html`, `archive.html`) are now
  site-root absolute (`/gallery.html`); four bodies were broken by the move to
  nested URLs.
- `Images/**` is ignored by Eleventy: now that markdown is a template format the
  `Images/**/Readme.md` notes were being published as five stray pages.

### Sitemap / SEO

- `publicPages` accepts directory-style URLs, so all 51 generated pages are in
  `sitemap.xml` (68 URLs, matching the expected set exactly).
- Year and category templates set `pagination.addAllPagesToCollections: true`;
  paginated pages are excluded from collections by default and were missing from
  the sitemap.

### Two accessibility/layout defects fixed in shared CSS

- The site's bare `nav { flex: 0 0 0; width: 0 }` (mobile burger breakpoint) and
  `nav ul …` rules also matched the article "More articles" `<nav>`, collapsing
  it below 1280px. They are now scoped to `body > header nav` — the same fix the
  sticky-`header` defect needed in Stage 13's first pass.
- `head.njk` no longer marks `<title>` as safe, so titles with `&` are valid
  HTML.

## Test coverage

- `tests/news-architecture.spec.js` (19 tests): landing structure and card
  counts, no duplicate featured story, every story linked from the landing page,
  historical items excluded from the current stream, one page per article,
  unique permalinks, counts (33 / 12 / 21 / 10), newest-first ordering with the
  undated notice last, category coverage, year/category/historical archives,
  homepage latest-three automation, article metadata and images, date format
  guard (no `GMT`/timezone/`Date.toString()` output), title length guard, title
  not sticky while scrolling, shared script/header controls, sitemap inclusion.
- `tests/helpers/site-pages.mjs` now registers seven representative Stage 13
  pages, so link, image, axe, SEO and visual audits cover the new page types.
- `tests/javascript-interactions.spec.js` and `tests/keyboard-accessibility
  .spec.js` were updated from the retired "toggle the article in place" model to
  the per-page model (card opens its article, lightbox still zooms, historical
  archive opens each story).
- `tests/build-output.spec.js` records the active-navigation expectation for the
  seven new pages and exempts pages that did not exist for the Stage 2A snapshot.
- `tests/homepage-fixtures.spec.js` builds its throwaway second copy with
  `SKIP_IMAGE_PIPELINE=true`; deploying 2,900 derivatives into a fresh directory
  outlasted the test's own build timeout, and the layout assertions never look
  at an image.
- `tools/capture-stage13-visuals.mjs` captures the landing page, one article per
  section, both archives and a category page at 1440/1024/768/375 in both
  themes, recording overflow, broken images, console errors and sticky titles.
- `tools/audit-news-accessibility.mjs` runs axe over the news pages at desktop
  and mobile widths in both themes.

## Verification results

- Playwright: **281 passed, 151 skipped, 0 failed** (5.5 min).
- HTML validation: 68 pages checked, 12 unique findings (all pre-existing legacy
  pages), 0 new, 34 baseline items resolved.
- axe: 28 checks (7 news pages × desktop/mobile × day/night), 0 violations.
- Internal links: 2,759 DOM references checked, 0 missing targets.
- Images: 2,864 references checked, 0 broken, 0 unresolved.
- SEO: 25 audited public pages, 25 unique titles/descriptions, 0 problems;
  sitemap 68 URLs = 68 expected, robots references the sitemap.
- Header collision probe: 550 checks, 0 problems.
- Stage 13 visual capture: 72 captures, 0 horizontal overflow, 0 broken images,
  0 console/page errors, 0 sticky titles.

### Page weight, news landing (1440×900, day)

| | Before Stage 13 | After |
| --- | --- | --- |
| Requests | 23 | 15 |
| Transferred | 1,996,814 B (1,950 KiB) | 801,185 B (782 KiB) |
| HTML document | 294,984 B | 28,817 B |
| Images | 1,096,564 B (13) | 155,920 B (5) |

Representative article page (2026 featured story): 13 requests, 954 KiB total,
15.8 KiB of HTML.

## Visual baselines

- The previous news landing baselines were archived to
  `reports/baseline/visual/stage13-news-before/` rather than deleted.
- New/updated baselines: news landing (desktop, tablet, mobile, night desktop)
  and desktop/tablet/mobile/night for one 2026 article, one 2025 article, one
  historical article, the 2026 archive, the 2025 archive, the historical archive
  and the Competition category page.
- No unrelated page baseline changed (the four `home-*.png` files were already
  modified by the Stage 12 refinement pass before this work).

## Environment notes

- Builds for this pass ran with `SITE_ROOT=_site-verify` and
  `IMAGE_CACHE_ROOT=.cache-alt\images`; `_site-alt` (the Stage 9–12 root) is held
  open by an external handle on this machine and cannot be deleted, so a second
  generated root was added to `.gitignore`.
- `tools/static-server.mjs` now serves directory URLs from their `index.html`,
  which is how GitHub Pages and `npx serve` behave; local preview previously
  404'd on every generated news permalink.

## Remaining editorial debt

1. Several article bodies still use legacy classes (`news-content`,
   `news-image`, `historical-list`) that no longer have CSS; they are carried by
   the generic `.article-body` rules and render correctly, but a future pass
   could retire the wrappers.
2. Historical items' standfirst/photo credits remain inside the body copy
   (newspaper captions); two items borrow their opening sentence as a meta
   description because the original excerpt was a photo credit.
3. `news/**/Readme.md` notes sit beside the photographs; they are now ignored by
   the build but still occupy the source tree.
4. The `News articles/` and `PhotoAlbums/` legacy pages remain for the 2025
   albums and are unchanged by this pass.
