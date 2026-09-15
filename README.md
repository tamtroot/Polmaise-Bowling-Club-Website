# Polmaise Bowling Club Website

The public website for Polmaise Bowling Club (Fallin, Stirling): fixtures, news,
membership information, photo galleries, club history, sponsors and honours.

The site is a static build. Templates, structured data, styles and photographs
live in this repository; `npm run build` renders them into `_site`, which is what
gets deployed.

## Requirements

- Node.js 22 (matches the GitHub Actions runner)
- npm 10+
- No database, CMS or server runtime

## Install

```powershell
npm ci          # exact dependency versions from package-lock.json
```

## Development

```powershell
npm run build   # render _site (HTML, images, sitemap, robots)
```

There is no long-running dev server in the repository; serve the built output
with the bundled static server when you want to click through the site:

```powershell
node tools/static-server.mjs --root _site --port 4173
```

If the repository lives in a cloud-synced folder (OneDrive), see
[ARCHITECTURE.md](ARCHITECTURE.md#cloud-synced-working-copies) for the
`SITE_ROOT` / `IMAGE_CACHE_ROOT` overrides.

## Build

```powershell
npm run build
```

This runs `tools/build-site.mjs`, which:

1. clears `_site`;
2. renders every page, partial and generated file with Eleventy;
3. generates the image derivatives the pages reference (cached in `.cache`);
4. verifies that every image reference in the built site resolves.

The build fails with a clear error when a reference cannot be resolved, when an
image cannot be processed, or when the output directory cannot be cleaned.

## Test

```powershell
npm run test:ci          # the lean release gate (after `npm run build`)
npm test                 # build + the full suite (optional regression, ~6 min)
npm run test:visual      # optional visual regression (Windows-captured baselines)
npm run test:diagnostic  # optional navigation/font and click-stress diagnostics
npm run test:build       # structure and deployment checks
npm run test:html        # html-validate against the accepted baseline
npm run test:links       # internal links, CSS references, placeholders
npm run test:audit       # console errors, failed requests, axe, page weights
```

`npm run test:ci` is the release gate — the same command the Pages workflow runs
after building. It blocks only on things a visitor would notice or that stop the
site being published: pages missing from the build, a page that does not render
(HTTP 200, `<main>`, no uncaught JavaScript errors, no broken images), broken
internal links, navigation and the core interactions (lightbox, gallery,
accordion, signup, live scores), horizontal overflow or overlapping header
controls at 1440px and 375px, a new serious/critical accessibility finding, and
missing structure/metadata/sitemap. It runs in about a minute.

Everything else is optional QA. `npm test` adds the exhaustive page × theme ×
viewport matrices, page audits, keyboard and SEO checks, the fixture-state
builds, rapid navigation, the font-swap measurements and the visual screenshots.
Screenshot baselines were captured on Windows and never match Linux
pixel-for-pixel, so they are for local design review rather than a release
blocker: [MAINTENANCE.md](MAINTENANCE.md) → *What blocks a release* explains the
classification and how to regenerate them.

The full suite is 300+ checks and includes the generated sections:

- `tests/news-architecture.spec.js` — the news collection, landing page,
  year/category archives and homepage automation;
- `tests/fixtures-ux.spec.js` — the four fixture season states, built with
  `FIXTURES_TEST_TODAY` (test-only) and cleaned up afterwards;
- `tests/historical-archive.spec.js` — the historical archive chronology,
  imagery, excerpts and cross-links;
- `tests/live-scoring.spec.js` — the scoreboard embed and its fallback;
- `tests/navigation-hit-target.spec.js` / `rapid-navigation.spec.js` — the
  navigation reliability guarantees.

Tests that need a second build write it to `_site-fixtures-<state>` (ignored,
and removed when the spec finishes); the production build never reads it.

Audit helpers:

```powershell
node tools/audit-accessibility.mjs     # axe + semantics/metadata audit per page
node tools/audit-repository.mjs        # dead selectors, JS hooks, page inventory
node tools/capture-layout.mjs before   # geometry fingerprint (all pages/viewports)
node tools/compare-layout.mjs before after
```

## Deployment

GitHub Pages, via `.github/workflows/static.yml`: `npm ci`, `npm run build`,
`npm run test:ci` (the lean release gate), then upload `_site`. Details and
rollback steps are in [RELEASE.md](RELEASE.md).

The deployment runs the same commands as a local release check:

```powershell
Remove-Item -Recurse -Force _site, .cache   # optional: forces a genuinely cold build
npm run build                               # ~13s warm, ~4min cold
npm run test:ci                             # the release gate; a failure stops the deploy
npm test                                    # optional: the full suite
```

## Image pipeline

Original photographs in `Images/` are the club archive. They are never modified
and are not deployed; the build generates WebP derivatives sized for their
rendered role. See [docs/image-pipeline.md](docs/image-pipeline.md).

## Data architecture

Repeated structured content lives in `_data/`: fixtures, honours, gallery
albums, archive items, PhotoAlbum metadata and sponsors. Derived state is built
from it at build time rather than in the browser:

- `_data/newsArchive.js` reads `news/**` into the news collection (articles,
  history, years, categories, the landing-page composition);
- `_data/fixtureSchedule.js` classifies every fixture (past/today/future) and
  derives the season summary, month groups and the collapsed completed fixtures;
- `_data/homepage.js` assembles the homepage from those sources plus
  `_data/homepageContent.json`.

Page templates only render. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Editing content

Step-by-step instructions for adding fixtures, news, gallery photos, honours,
sponsors and images are in [MAINTENANCE.md](MAINTENANCE.md).

## Colour scheme and typography

The design system is the Polmaise day/night theme; both themes are built from
semantic tokens, so pages never hard-code a colour:

- day: Club Blue `#1E3A8A`, Light Blue `#4B71BF`, Dark Blue `#0F2557`
- night: graphite surfaces with light-blue accents
- status colours stay conventional and accessible (positive / warning / neutral)
- headings Merriweather, body Open Sans, wordmark Playfair Display — all
  self-hosted in `vendor/fonts` with a metric-matched fallback

The full token list lives in `styles.css`; the theme toggle and its persistence
are documented in [MAINTENANCE.md](MAINTENANCE.md#day-and-night-themes).
