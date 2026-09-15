# Maintenance guide

Everything below is edited in the repository; the site is rebuilt by
`npm.cmd run build` (or automatically by GitHub Actions on push to `main`).

## Fixtures

Edit `_data/fixtures.json`. Each record drives both the desktop table row and
the mobile card, so they can never drift apart:

```json
{ "date": "04-Apr", "competition": "Opening of Green", "day": "Saturday",
  "venue": "Polmaise", "status": "Confirmed" }
```

`status` is free text and becomes the badge class: `Confirmed`, `TBC`,
`Proposed`, or `—` for a blank fixture.

`venue` also decides the Home/Away tag: `Polmaise` is Home; `Various`,
`Home & Away`, `TBC` and `—` stay unlabelled; anything else is Away.

The file carries `season` (currently `2026`). Dates are day-month only
(`04-Apr`; a range is written `08-Aug to 15-Aug` and uses its first date), so
the season year supplies the year. Keep the array roughly in date order — the
page sorts by date (ties keep file order) and rows without a usable date stay at
the end.

### Fixture state (Stage 14)

`_data/fixtureSchedule.js` classifies every fixture **at build time** and the
templates only render, so the page carries no date arithmetic and every visitor
(and search engine) sees the same state:

| State | Rule |
| --- | --- |
| `past` | usable date before the build day |
| `today` | usable date equal to the build day |
| `future` | usable date after the build day |
| `unknown` | no usable date, or a placeholder competition (`—`) |

From that it derives the latest completed fixture, the next fixture, upcoming
fixtures (ascending), completed fixtures (most recent first), month groups and
the counts shown in the season summary. The date helpers live in
`tools/fixture-schedule.mjs` and are shared with `_data/homepage.js`, so the
homepage and the fixtures page can never disagree about what is next.

The build day is the day the site was generated (UTC). Rebuilding moves the page
on — the same behaviour as the old browser-side script, but now identical for
everyone and testable (`FIXTURES_TEST_TODAY` pins it for the regression tests;
production builds never set it).

### How the page presents it

- **Season summary** — latest result, next fixture (or the season-complete
  state) and season status, all from the data above. Results are not part of the
  fixture data, so the card says the result is not recorded and links to club
  news; no score is ever invented.
- **Full season** — one table, in the club's order, grouped by month with
  "Past fixtures" / "Upcoming fixtures" labels. The next fixture is highlighted
  and flagged `Next`.
- **Show earlier fixtures** — the four most recent completed fixtures stay
  visible and everything earlier is collapsed behind a native button
  (`aria-expanded`, mirrored in the mobile card list). All fixtures remain in
  the generated HTML; without JavaScript nothing is collapsed and the button is
  hidden, so no fixture is ever stranded. The count of hidden fixtures is shown
  on the button.

### New season

1. Bump `season`.
2. Replace the fixture records with the new list.
3. Rebuild. The page heading, summary, month groups, homepage cards and the
   download wording all follow from the data. The printable PDF link is still a
   literal path in `fixtures.html` — point it at the new season's PDF when it is
   supplied.

### Calendar export (deferred)

An `.ics`/webcal export was investigated and deliberately deferred: the list
carries dates and a status only — no kick-off times — and several fixtures are
`TBC` or `Proposed`, so generated events would be misleading. Revisit if times
are added to the data.

## Homepage

`index.html` is assembled from data rather than hard-coded content:

- `_data/homepageContent.json` — the curated editorial index: hero copy, the
  latest result, the three featured stories, the history block and the
  membership badges. Every entry mirrors content already published on
  news.html / history.html / membership.html; update it when the featured
  stories change.
- `_data/homepage.js` — derives the next/upcoming fixtures from
  `_data/fixtures.json`, the six gallery tiles from `_data/gallery.json`, the
  sponsor strip from `_data/sponsors.json`, and exposes `seasonComplete`.

Homepage news is a **hand-maintained curated selection** on purpose: it is not a
weekly task and must not depend on manual AI or editorial input. Stage 13 is
expected to introduce an Eleventy news collection (news as data rather than
prose in `news.html`) so the homepage can render the newest published stories
automatically; until then, update the three entries in `homepageContent.json`
when the featured stories change.

The "New to bowls" section uses `Images/Try Bowls.png`, a club photograph of a
coaching session on the green. Keep a picture of people actually trying or being
coached at bowls here; do not substitute a stock or fabricated image.

Two tests cover it: `tests/homepage.spec.js` (structure, links, both themes,
overflow at five widths, and the production empty state) and
`tests/homepage-fixtures.spec.js`, which builds a second copy of the site into
`_site-stage12-variant/` with synthetic fixtures (through the
`STAGE12_TEST_FIXTURES` environment variable) to exercise the "Next Fixture" and
"This Week at the Club" layouts, then proves the synthetic data is absent from
the published build. Production builds never set that variable.

Eleventy gotcha found here: two data files whose names share a base name merge
into one data namespace (`homepage.js` plus `homepage.json` concatenated their
arrays), which is why the content file is named `homepageContent.json`.

## News

Every article is its own file. `news.html` is a generated landing page and must
not be edited to add stories.

### Publishing a news article

1. Create `news/<year>/<slug>.md` (for example
   `news/2026/presentation-dance-2026.md`). The body is HTML lifted from the
   article - paragraphs in `<p>`, subheadings in `<h4>`/`<h5>`, lists in
   `<ul>`/`<li>` - and photographs use:

   ```
   {% photoImage "../../../Images/<folder>/<file>.jpg", "Alt text", { loading: "lazy", sizes: "(max-width: 768px) 90vw, 375px", class: "zoomable-image" } %}
   ```

2. Fill in the front matter:

   ```yaml
   ---
   title: "Headline as it should read on the page"
   date: "2026-09-05"          # the machine-readable date
   isoDate: "2026-09-05"       # identical to `date`
   category: "Tournament"      # see the category list below
   year: 2026
   excerpt: "One or two sentences from the article, used on cards and in search results."
   image: "./Images/2026/<folder>/<file>.jpg"
   imageAlt: "What the lead photograph shows"
   imageCaption: "Optional caption printed under the photograph"
   featured: true              # only on the story that leads the landing page
   newsSection: "current"
   legacyId: "article-<slug>"  # keeps old news.html#article-<slug> links working
   permalink: "/news/2026/<slug>/"
   layout: news-article.njk
   templateEngineOverride: "njk"
   tags: newsArticle
   ---
   ```

   - Leave `featured` out of every other article. The landing page falls back to
     the newest story when nothing is flagged.
   - `excerpt` is required: it becomes the meta description, the card text and
     the Open Graph description. A short one fails the SEO audit.
   - The human-readable date ("5 September 2026") is derived from `isoDate` by
     `tools/news-dates.mjs`; never write a display date by hand.
   - Categories in use: `Competition News`, `Tournament`, `Community
     Engagement`, `Club Event`, `Club News`, `Club Achievement`, `Friendly
     Fixture`, `Special Event`, `Media Coverage`, `New Archive Added`. The
     landing page groups them into Competition / Tournament / Community / Club
     through `CATEGORY_GROUPS` in `_data/newsArchive.js`; a new wording must be
     added to a group there, or its stories will not appear under a category.

3. Run `npm run build` and check `/news.html`.

Nothing else needs editing. Publishing one file automatically updates:

- the news landing page (featured story, "Latest from Polmaise", "More news",
  category counts, archive counts);
- that year's archive page (`/news/<year>/`);
- the category pages (`/news/category/<slug>/`);
- `sitemap.xml` and the per-page SEO/social metadata;
- the homepage "Latest from Polmaise" cards (the three newest articles).

There is no weekly run, scheduler or AI step: the site is generated from these
files on every build.

### Adding a historical archive item

Historical stories live in `news/history/<slug>.md` with the same front matter
plus `archiveCategory: "Historical"`, `newsSection: "history"` and
`tags: newsHistory`. Use the report's own publication date for `date`/`isoDate`
(for example `"1911-06-03"`). Historical items appear on `/news/history/`
("From the Green, Through the Years") and never in the current news stream.

### The historical archive page (Stage 15)

`/news/history/` is the **article archive**: the reports and club stories
themselves, one page per item, listed by year. `history.html` is the **narrative
club history** written for the site. They are deliberately separate; each links
to the other ("Explore the historical archive" / "Read the club history"), and
neither duplicates the other's content.

- **Order** — `_data/newsArchive.js` sorts `history` by `year`, then by
  `isoDate`, so the page reads chronologically (3 June 1911 before 15 July 1911).
- **Year chapters** — `historyYears` groups that list into one entry per year,
  so a year with several stories (1911) is shown once with its stories beneath
  it. The year is a `<h3>`; each story title is an `<h4>`.
- **The rail** — decoration only. Every year's stories are stacked in a single
  column; `.archive::before` draws the rail and each `.archive-item::before` is a
  brass dot. Years and dates are always real text, so the chronology survives
  with CSS and images removed.
- **Excerpts** — each row shows the article's own `excerpt`, trimmed to complete
  sentences by `tools/news-excerpts.mjs` when it would be too long (never cut
  mid-sentence or mid-word, never reworded, no ellipsis). The full excerpt still
  feeds the meta description.
- **Images** — every image is shown whole inside the same frame (`max-width` /
  `max-height` with the source aspect ratio, so nothing is cropped, stretched or
  enlarged past its source). Newspaper cuttings carry
  `imageType: "clipping"` in front matter and get a warm archival panel behind
  them; everything else defaults to a photograph on the plain surface. Add
  `imageType: "clipping"` when a new archive item uses a press cutting.

### Writing conventions the build enforces

- Article bodies are HTML, not markdown (`templateEngineOverride: "njk"`).
  Markdown processing would wrap stray text in paragraph tags of its own.
- Links inside an article must be site-root absolute (`/gallery.html`) or
  document-relative (`../..`): a bare `gallery.html` breaks because articles
  live three directories below the site root.
- `tools/normalise-news-frontmatter.mjs` and `tools/normalise-news-markup.mjs`
  tidy front matter and body markup. Run either with `--check` to see drift, or
  with no arguments to rewrite. Both refuse to write a file whose visible text
  would change.

For a one-off article page outside the collection (the older album pages), copy
`News articles/presentation-dance-2025.html` and update the front matter
(`pageTitle`, `metaDescription`, `permalink`, `prefix: "../"`).

## Gallery albums

`_data/gallery.json` holds two things:

- an optional `coverImage` per album (`{ "src": …, "alt": … }`) used by the
  homepage strip. When it is present the homepage shows that photograph;
  otherwise it falls back to the first full-size image in the album and finally
  to the first `-thumb` derivative. Set it when the first image in an album is
  not the most representative one — without it, appending a photo to an album
  silently changes the homepage cover.

- `cards` — the album tiles. Use `open` for an album rendered on the same page,
  or `link` for a card that navigates (e.g. a PhotoAlbum page).
- `albums` — each album's `id`, `title`, `sections[].images` and close button.

An image record is `href` (full-size source), `src` (grid source), `alt`, and
optionally `title`, `caption`, `decoding`, `width`/`height`, `extraClass`.
Add `{ "heading": "…" }` sections to group photos under a sub-heading.

The archive album (`album7`) is generated in `gallery.html` from
`Images/Archive/Photo N.jpg` / `Photo N-thumb.jpg`; if you add archive photos,
extend the loop bounds and the derivative-registration loop above it together.

## PhotoAlbum pages

Add the filenames to `_data/photoAlbums.json` under the album's key:

```json
"presentation-dance-2025": {
  "galleryId": "presentation-gallery",
  "directory": "../Images/2025/PresentationDance2025/",
  "group": "presentation-2025",
  "titlePrefix": "Presentation Dance 2025 - Photo ",
  "altPrefix": "Presentation Dance 2025 - Photo ",
  "images": ["20251025_200718.jpg"]
}
```

Order matters: photos appear in array order and captions are numbered from it.

## Honours

`_data/honours.json`:

- `years` — newest first. Each has `achievements[]` and optionally
  `competitionHeading` + `competitions[{ name, winner }]`. A year with only
  `note` renders the note instead of a list (used for 2020).
- `presidents`, `champions`, `ladiesChampions` — `columns[][]` of
  `{ year, name }`, plus optional `emphasis` (italic note) and `current` flags.

Add a new season at the top of `years` and append the new office-holders to the
last column of the relevant board.

## Sponsors

`_data/sponsors.json` has `main` (large cards, optional `banner`) and `club`
(business cards, optional `logo`). A contact is
`{ "icon": "fas fa-phone", "text": "…" }` or
`{ "icon": "fas fa-globe", "text": "…", "href": "https://…", "target": "_blank" }`.
Logos are resized in their original format by `{% photoGraphic %}` — keep using
PNG/SVG for logos rather than photographic formats.

## Images

1. Drop the original into the right folder under `Images/` (do not pre-resize).
2. Reference it from data (gallery/archive/PhotoAlbums) or from a template with
   `{% photoImage "./Images/…", "Alt text", { sizes: "…" } %}`.
3. Run `npm.cmd run build`; derivatives are created automatically and the build
   fails if a reference is missing.
4. Run `node tools/write-image-manifest.mjs` so the archive-preservation check
   covers the new file.

## Day and night themes

The site ships one component system with two themes. The day theme is the
default and needs no JavaScript; the night theme is opt-in through the header
toggle and is remembered in `localStorage` (`polmaise-theme`).

1. All colours come from semantic tokens in `styles.css` (`--color-bg`,
   `--color-surface`, `--color-surface-alt`, `--color-text`,
   `--color-text-muted`, `--color-primary`, `--color-accent`,
   `--color-accent-soft`, `--color-border`, `--color-focus`,
   `--color-on-primary`, `--color-on-inverse`, the `--color-positive/warning/
   neutral/notice/heritage-*` status tokens, `--color-row-stripe`,
   `--color-row-hover`).
2. Add a new colour by defining it in the `:root` block **and** in the
   `[data-theme="dark"]` block. Never give a component its own
   `[data-theme="dark"]` override unless the value is genuinely
   theme-specific.
3. `_includes/head.njk` applies the saved theme before first paint so there is
   no flash; `script.js` keeps the toggle, its `aria-pressed` state and the
   stored preference in sync.
4. Inline `style` attributes are not used for presentation: add a class
   instead. Only per-image focal points passed to `{% photoImage %}` keep a
   `style` option.
5. Coverage: `tests/theme.spec.js` (toggle behaviour), `tools/audit-accessibility.mjs`
   (axe in both themes at desktop and mobile), `tools/audit-header-layout.mjs`
   (header collisions across breakpoints) and the visual baselines
   (`<page>-<viewport>.png` for day, `<page>-night-desktop.png` for desktop
   night).

## Third-party assets (vendor/)

The site does not load anything from a CDN. jQuery, Lightbox2, Font Awesome and
the web fonts live in `vendor/` and are copied into the build:

```powershell
node tools/fetch-vendor-assets.mjs   # refresh the pinned versions
```

The script pins exact versions, trims the Font Awesome stylesheet to the solid
and brand faces the site uses, and keeps only the `latin` font subset. Two tests
protect this: `tests/external-dependency-resilience.spec.js` (the site must
paint and stay interactive even when third-party origins are stalled, and no
page may load scripts, styles or fonts cross-origin) and
`tests/rapid-navigation.spec.js` (clicking quickly through the site must never
leave a page unresponsive; the mobile drawer must never arrive open or leave
`body` scroll-locked).

When adding an icon, check it exists in `fa-solid` or `fa-brands`: the other
Font Awesome faces are deliberately not shipped.

## Club crest

`Images/club-logo.png` must have a transparent background. The archived asset
was exported on an opaque white square, which showed as a white box in the night
theme — the source of the long-standing logo defect:

```powershell
node tools/normalise-club-logo.mjs --check   # is the background transparent?
node tools/normalise-club-logo.mjs           # mask everything outside the badge circle
```

The crest is only 110px wide, so it is displayed at 56px in the header and
110px (88px on mobile) in the homepage welcome panel; the image pipeline never
upscales. After changing any original run `node tools/write-image-manifest.mjs`.

## Header breakpoints

The inline desktop navigation needs room for the club wordmark and the theme
toggle, so it appears at **1280px and above**; below that the burger menu takes
over. `script.js` reads the same `min-width: 1280px` media query, so the two can
never disagree.

The navigation must also keep still while the web fonts load: it is
right-aligned with no reserved widths, so a fallback font with different metrics
used to re-flow every item by up to 33px while the gap between items is only
4px, which made clicks land in the gap (nothing happened) or on the neighbouring
page. Two things prevent that:

1. `styles.css` declares a metric-matched `'Open Sans Fallback'` family (one
   `@font-face` per system font with its own measured `size-adjust`) and lists it
   straight after `'Open Sans'` in `--font-ui`.
2. `_includes/head.njk` preloads the Open Sans and Playfair Display files that
   the header needs, so the real metrics are normally there for the first paint.

`tests/navigation-hit-target.spec.js` guards both: it fails if any navigation
item moves 3px or more across the font swap (light and dark, 1440/1280/1024px)
and it clicks nine points across the label the user sees. Re-tune after changing
a font with `node tools/diagnose-navigation-lock.mjs --tune`.

## Common troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Footer shows the wrong year | it is rendered from the build year (`buildYear` in `eleventy.config.js`); rebuild the site |
| `Image pipeline produced N unresolved reference(s)` | a template or data file points at a file that is not in `Images/`; the message lists the missing paths |
| Images appear as broken icons on one page | usually a stale server serving an old `_site`; stop it and rebuild |
| `EBUSY`/`EPERM`/`Access is denied` while cleaning `_site` | a cloud-sync client is holding generated files; exit/pause syncing, delete `_site`, rebuild, or use `SITE_ROOT`/`IMAGE_CACHE_ROOT` |
| Visual test fails after an image change | run `npm run test:visual` and inspect the diff artefacts in `test-results/`; only update baselines with `npm run baseline:update` once the change is approved |
| Fixtures page looks wrong on a specific day | fixture styling is date-driven; tests freeze the clock, the live site does not |
| Live Scores shows a service error | the embedded third-party score service is unavailable; the rest of the site is unaffected |
| A page seems frozen after clicking through several pages quickly | run `npx playwright test tests/rapid-navigation.spec.js tests/external-dependency-resilience.spec.js`; a page must paint and stay interactive even when outside origins stall |
| An icon renders as an empty circle | the glyph is the same colour as its background, or it lives in a Font Awesome face that is not shipped (`vendor/` carries only solid and brand) |
| A navigation click occasionally opens the wrong page or does nothing | the menu moved under the cursor while the web font loaded: rebuild and run `npx playwright test tests/navigation-hit-target.spec.js`; the tuned fallback and preload keep the items still |
| The burger menu closes by itself shortly after opening | check the drawer reset logic in `script.js`: it may only run on a back/forward restore (`event.persisted`), never on a normal load |

## Releasing, previewing and rolling back

- **Local preview**: `npm run build` then
  `node tools/static-server.mjs --root _site --port 4173` (the server resolves
  directory URLs, matching GitHub Pages). `npx serve _site` also works.
- **Release check**: `npm ci && npm test` — the same commands the Pages workflow
  runs; a failure stops the deployment.
- **Clean build**: delete `_site` and `.cache`, then `npm run build` (~4 minutes
  cold, because all 2,945 image derivatives are regenerated).
- **Deployment, rollback, smoke-test checklist and the release notes**:
  [RELEASE.md](RELEASE.md).
- **Live scoring**: the embed is a third-party service that has been known to
  return HTTP 401. A cross-origin frame's status cannot be read from the page,
  so the copy is deliberately honest ("if the board does not load, live scoring
  may be unavailable") and a fallback panel appears only when the board fails to
  load at all within ten seconds. The single 401 console message is expected.

## Known product decisions (do not "fix" silently)

- There is no login, signup backend or contact form: `signup.html` is a
  front-end-only demo and its success alert deliberately no longer redirects to a
  non-existent `login.html`.
- The gallery card **Club Events and Achievements** (`album5`) opens nothing
  because no album with that id has ever existed in this repository. Content
  ownership was never defined, so it is left for a content decision.
- Twitter/Instagram/YouTube icons are decorative: the club has no verified URLs
  for them, so they are not links.

## Backlog (known, deliberately not done yet)

- **Font Awesome payload**: every page loads `all.min.css` (100 KB) plus the
  solid (147 KB) and brands (107 KB) WOFF2 files — about 355 KB for the ~30
  glyphs the site uses. A real reduction needs WOFF2 subsetting (a Python
  font toolchain in CI), so it is deferred rather than risked at release time.
- **Gallery page weight**: `gallery.html` is 313 KB of HTML plus ~96 KB of
  inline album JavaScript and 459 KB of images. Worth splitting the album data
  out of the page in a future pass.
- **`signup.html`** is a front-end-only demo that is in the sitemap but linked
  from nowhere (see "Known product decisions"). Decide whether it should be
  published at all, or kept out of the sitemap.
- **Legacy pages**: `News articles/presentation-dance-2025.html` and
  `PhotoAlbums/top-15-final-2025.html` are reachable by URL but linked from no
  page. Either link them (gallery/news) or treat them as archived URLs.
- **Fixture calendar export** (`.ics`): blocked on kick-off times and confirmed
  venues appearing in `_data/fixtures.json` (see the Fixtures section).
- **Fixture filtering** (competition, home/away): deferred. The season summary,
  month grouping and the collapsed completed fixtures already keep the page
  short; a filter would add JavaScript for little gain while the list is this
  size.
