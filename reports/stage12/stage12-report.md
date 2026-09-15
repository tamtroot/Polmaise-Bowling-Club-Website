# Stage 12 — premium homepage redesign

Scope honoured: homepage only. No changes to the token architecture, the
day/night system, the 1280px navigation breakpoint, the font-swap fix, the image
pipeline, shared accessibility logic, or any other page's structure.

## 1. Homepage architecture

One `<main>` with eight sections, in this order:

| # | Section | Classes | Purpose |
| --- | --- | --- | --- |
| 1 | Hero | `.home-hero` | Identify the club, state what it is, offer three routes |
| 2 | Feature strip | `.home-features` | Next fixture / latest result / live scores as one module |
| 3 | Latest from Polmaise | `.home-news` | Three most recent stories with photography |
| 4 | This Week at the Club | `.home-schedule` | Upcoming fixtures, or the season-complete state |
| 5 | A club with history | `.home-history` | 1911 heritage, archive photograph, three facts |
| 6 | Gallery strip | `.home-gallery` | Six recent album images |
| 7 | New to bowls | `.home-join` | Welcoming membership call to action with four badges |
| 8 | Our sponsors | `.home-sponsors` | Six existing sponsor logos |

The shared header and the Stage 10 footer are untouched.

## 2. Sections added / reworked

Replaced the old hero + welcome + four quick-link cards with the eight sections
above. The old `.hero`, `.welcome` and `.quick-links` blocks are gone from
`index.html` (their shared CSS remains in `styles.css` for other pages). The hero
is a new component (`.home-hero`, not the shared `.hero`) with a themed scrim, so
no other page's hero styling changed.

## 3. Data sources

| Section | Source |
| --- | --- |
| Next fixture, This Week at the Club | `_data/fixtures.json` (a `season: 2026` key was added so the day-month dates can be placed in a year; items with `—` placeholders are skipped) |
| Gallery strip | `_data/gallery.json` — first full-size image of the six most recent albums, alt text reused |
| Sponsor strip | `_data/sponsors.json` — first six club sponsors that have a logo |
| Hero, latest result, news, history, membership copy | `_data/homepageContent.json` — a curated index of content **already published** on news.html, history.html and membership.html (same dates, titles, images, wording). No new club facts, results, statistics or URLs were invented |
| Derived values | `_data/homepage.js` computes the next/upcoming fixtures, the last played fixture, the gallery and sponsor strips, and exposes `seasonComplete` |

Nothing is duplicated inside `index.html`; the page only reads data.

## 4. Images selected

| Role | Image | Why |
| --- | --- | --- |
| Hero | `Images/Archive/Photo 25.jpg` | Wide clubhouse/green photograph already used as the site's social image; calm left side for the text scrim |
| Latest result (detail) | from `homepageContent.json` (Chucks Memorial winners) | The most recent published result |
| News cards | `Chucks 2026/Winners.jpg`, `Aaron Champ of Champs/Aaron & President Davie.jpg`, `Charlie McNiel 2026/Champs.jpg` | The three most recent stories' own photographs |
| History | `Images/Archive/HistoricalArchive/Golden Jubilee.jpg` | Historical club photograph, reads as heritage |
| Gallery strip | first full image of the six newest albums (Finals Day 2026, Opening of Green 2026, Top 15 Final 2025, Bone family, Ladies Top 5 2025, Murray Cup 2025) | Representative recent activity, no new curation data |
| New to bowls | `Images/club-image.png` | The Polmaise crest on the club gate |
| Sponsors | the clubs' own logo files via `photoGraphic` (original format, never distorted) | Do not rebrand sponsor logos |

All images go through the pipeline (`photoImage`/`photoGraphic`): responsive
`srcset`, `sizes`, explicit dimensions, `decoding="async"`. The hero is eager
with `fetchpriority="high"`; everything else is lazy. Build output confirms 2,035
image references verified, 0 unresolved.

## 5. Day theme design notes

White page, pale-blue alternating bands (`--color-surface-alt`) for the news and
history/membership sections, navy headings, sky-blue eyebrows, hairline
separators, restrained shadows. The hero uses a light navy scrim
(`rgba(11,24,56,0.86) → 0.18`) so it reads as a bright day photograph with a
readable text panel rather than a dark night-style overlay. Buttons are solid:
navy primary plus near-white secondary with dark ink (the Stage 10 inverse
button tokens).

## 6. Night theme design notes

Graphite/near-black page, dark navy surfaces, off-white text, electric blue
accents, cooler borders. The same hero uses a deeper scrim
(`rgba(4,8,16,0.90) → 0.28`), so the composition is identical but darker in
keeping with the theme — no colour inversion, and the photo stays visible.
Card borders are visible without glow, and the sponsor tiles keep their logos
legible on `--color-surface`.

## 7. Responsive behaviour

| Width | Layout |
| --- | --- |
| 1440px+ | Hero text panel max 46rem; 3 feature cards, 3 news cards, 6 gallery tiles, 6 sponsor tiles |
| 1280px | Same, inline navigation (unchanged breakpoint) |
| 1024px | Burger navigation; 2-column feature/news grids (third feature spans), 3 gallery/sponsor tiles |
| 768px | History and membership sections stack (image first); 2-column news; 6rem-high sponsor tiles |
| 375px | Single-column everything, 4 gallery tiles (2 hidden), 2-column sponsor grid, stacked badges, full-width CTAs |

Verified with zero horizontal overflow across 375/768/1024/1280/1440 in both
themes (a test asserts `scrollWidth === innerWidth` and no element crossing the
viewport edge).

## 8. Accessibility

- axe: **0 violations** in all four passes (day/night × desktop/mobile) on all
  18 pages, including the new homepage (happy-club audit tool
  `tools/audit-accessibility.mjs`).
- One `h1` (the header wordmark) and one `h2` per section; card headings are
  `h3`. The feature strip uses `aria-label` on the section rather than a hidden
  heading.
- Headline cards use a single stretched link (`h3 > a::after`) so the whole card
  is clickable without nesting links; the "Read more" affordance is decorative.
- Focus rings use the shared `--color-focus` token, overridden to white inside
  the photographic hero where a blue ring would be hard to see.
- No clickable divs; all actions are links or buttons.
- Keyboard suite and navigation-hit-target suite pass unchanged.

## 9. Test results

| Gate | Result |
| --- | --- |
| Full Playwright suite | **213 passed, 0 failed** (4.8 min, exit 0) — was 191 before Stage 12 |
| New homepage suite | `tests/homepage.spec.js`: structure, hero routes, news cards, schedule state, gallery/sponsor images, overflow matrix, no-leak check |
| New fixture-state suite | `tests/homepage-fixtures.spec.js`: builds a second copy of the site with two synthetic fixtures and asserts the Next Fixture card and schedule rows render, then asserts the production build contains neither |
| axe (4 passes) | 0 violations |
| Header collision probe | 396 checks, 0 problems |
| Visual regression | 68 non-homepage baselines pass unchanged; 4 homepage baselines regenerated |
| Internal links / images | 0 missing targets, 0 broken images (2,035 references) |
| Console / page errors | none on the homepage |
| Structural test | `tests/build-output.spec.js` now documents a homepage exemption (the Stage 2A snapshot no longer describes the redesigned page); every other page is still compared exactly |

## 10. Homepage visual review findings

Reviewed day and night at desktop, tablet and mobile (plus both themes at mobile
and tablet through the capture tool).

- Hero: copy aligns to the site grid, three CTAs are solid and legible over the
  photograph in both themes; the trophy and green remain visible.
- Feature strip: reads as one module; the "Season complete" state sits in the
  Next Fixture cell rather than leaving a hole.
- News: three cards, consistent 16:10 crops, dates and categories legible,
  hover lift subtle.
- Schedule: the season-complete panel names the date the season finished
  (13-Sep at Polmont, read from the fixture list) and offers news + fixtures.
- History: brass rules over three facts, historical photograph on the left;
  day treatment stays light, night stays graphite.
- Gallery: six evenly cropped tiles; on mobile four remain.
- Membership: badges and both CTAs are clear; crest-gate photograph crops well.
- Sponsors: all six logos load and stay legible on both themes; some carry their
  own internal whitespace (their artwork, left untouched).
- Fixed during review: the news grid initially rendered six cards because two
  Eleventy data files shared the `homepage` namespace (arrays were merged);
  the curated content file is now `_data/homepageContent.json`.

## 11. Page weight before / after

| Metric | Before | After | Change |
| --- | --- | --- | --- |
| Homepage requests | 14 | 23 | +9 (news, gallery, sponsor imagery) |
| Homepage transfer (uncompressed) | 948,370 B (926 KiB) | 1,355,942 B (1,324 KiB) | +407,572 B (+43%) |
| Document (HTML + inline homepage CSS) | 12 KiB | 48 KiB | +36 KiB (**≈8 KiB gzipped**) |
| Images | 4 / 323 KiB | 13 / 685 KiB | +9 / +362 KiB |
| CSS files | 3 / 148 KiB | 3 / 148 KiB | unchanged |
| JS | 1 / 9 KiB | 1 / 9 KiB | unchanged |
| Fonts | 5 / 434 KiB | 5 / 434 KiB | unchanged |
| Largest resources | Photo 25 hero 165 KiB, club-image 149 KiB | + Golden Jubilee 107 KiB, FA fonts 147/107 KiB, FA CSS 98 KiB | |

`styles.css` and `script.js` are byte-identical to Stage 11 — the homepage work
added no shared-file weight, and no new external origins were introduced. Most
extra weight is the three editorial photographs (hero 165 KiB, membership 149 KiB,
history 107 KiB), which are above/below the fold appropriately and lazy-loaded
except the hero. The homepage remains lighter than News (1,950 KiB) and Gallery
(1,462 KiB).

## 12. Remaining homepage polish items

1. News cards link to `news.html` rather than deep-linking the specific story
   (the news page has no hash handling); adding it would need a small change to
   the news page's script, deliberately left out of scope.
2. Night tablet/mobile are reviewed but not baselined (the suite keeps one night
   baseline per page, desktop) — consistent with the Stage 9/10 policy.
3. The fourth gallery tile (the Bone family bowls display) is less photographic
   than its neighbours; swapping it needs a curated pick rather than data.
4. Sponsor tiles vary in visual weight because the logos are the clubs' own
   artwork; a shared optical-size pass would need sponsor cooperation.
5. The inline homepage CSS could move to a cached `homepage.css` if we ever want
   to trim the document further (currently ~8 KiB gzipped).
6. When the 2027 fixtures are published, bump `season` in `_data/fixtures.json`
   and add the new fixtures — the homepage switches from the season-complete
   state automatically.

## 13. Git diff summary

Changed: `index.html` (rewritten body + homepage CSS), `_data/fixtures.json`
(`season: 2026`), `.gitignore` (`_site-stage12-variant/`),
`tests/build-output.spec.js` (documented homepage exemption),
`tools/capture-stage9-visuals.mjs` (waits for images before capture), the four
`home-*.png` visual baselines, and refreshed measurement/audit reports.

Added: `_data/homepage.js`, `_data/homepageContent.json`,
`tests/homepage.spec.js`, `tests/homepage-fixtures.spec.js`,
`reports/baseline/visual/stage11/` (the previous homepage baselines), and this
report.

No other page, no shared stylesheet, no script and no token changed.
