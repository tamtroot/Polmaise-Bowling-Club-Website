# Architecture

## Build shape

```
                         ┌───────────────────────────┐
  templates (.html/.njk) │  Eleventy 3 (11ty)        │  _site/**.html
  front matter           │  html + njk engines       │  _site/sitemap.xml
  _data/*.json           │  filters & shortcodes     │  _site/robots.txt
  _includes/*.njk        └─────────────┬─────────────┘
  styles.css, script.js                │
  Images/**  (archive)                 ▼
                         ┌───────────────────────────┐
                         │  tools/image-pipeline.mjs │  _site/Images/**  (derivatives)
                         │  Sharp + hash cache       │
                         └───────────────────────────┘
```

`tools/build-site.mjs` is the entry point: it cleans `_site`, preloads the image
index, runs Eleventy, then runs the image pipeline and its reference check.

## Eleventy structure

| Path | Purpose |
| --- | --- |
| `*.html` | One template per public page. Front matter carries `pageTitle`, `metaDescription`, `permalink`, `navActive`, `prefix`/`assetPrefix` (relative-path depth), `headVariant`, `scriptJs`, `jquery`, `lightboxCss`, `lightboxScript`, `facebookLink`. |
| `_includes/head.njk` | Meta tags, canonical, Open Graph/Twitter, JSON-LD, stylesheet and CDN scripts. |
| `_includes/header.njk` | Logo, primary nav (active state from `navActive`), mobile menu button, optional dropdown. |
| `_includes/footer.njk` | Address/contact block, quick links, social icons, copyright. |
| `_includes/scripts.njk` | `script.js` include and the Lightbox2 script when a page needs it. |
| `_includes/photo-album-gallery.njk` | The shared PhotoAlbum gallery script (used by four pages). |
| `sitemap.njk`, `robots.njk` | Generated `sitemap.xml` and `robots.txt` (excluded from collections). |
| `_data/site.json` | Production URL, club name, contact details, default social image. |
| `news/**/*.md` | The news collection: one file per article (2026, 2025 and `history/`). Bodies are HTML, rendered with `templateEngineOverride: "njk"`. |
| `_includes/news-article.njk` | The article layout (header, hero, body, previous/next, back link, lightbox) used by every article. |
| `news/year.njk`, `news/category.njk`, `news/history/index.njk` | The generated year archives, category pages and the historical archive index. |

`eleventy.config.js` registers the passthrough copies (`styles.css`,
`script.js`, `downloads/`), the ignore list, the image filters/shortcodes, the
`publicPages` filter used by the sitemap, and the `dir`/engine settings. It
honours `SITE_ROOT` for the output directory.

## Data files

| File | Contents | Rendered by |
| --- | --- | --- |
| `_data/fixtures.json` | 50 fixture records (date, competition, day, venue, status) | `fixtures.html` table **and** mobile cards |
| `_data/honours.json` | 17 season records, three honour boards | `honours.html` |
| `_data/gallery.json` | 23 album cards, 20 albums with sections/images | `gallery.html` |
| `_data/archive.json` | 117 Sandy Deans archive items | `archive.html` |
| `_data/photoAlbums.json` | 4 albums (directory, group, caption prefixes, filenames) | `PhotoAlbums/*.html` via the shared include |
| `_data/sponsors.json` | 2 main sponsors, 12 club sponsors, contact lines | `sponsors.html` |
| `_data/site.json` | Site-wide metadata and `SportsOrganization` facts | every page (head) |
| `_data/newsArchive.js` | Reads `news/**/*.md` into `articles`, `history`, `historyYears`, `years`, `categories`, the landing-page composition and the legacy anchor redirects | `news.html`, the archives, the homepage |
| `_data/fixtureSchedule.js` | Classifies every fixture at build time (past/today/future/unknown) and derives the season summary, month groups and collapsed completed fixtures | `fixtures.html`, homepage |
| `_data/homepage.js` | Assembles the homepage: next fixture, latest result, gallery strip, sponsor strip | `index.html` |
| `_data/homepageContent.json` | Curated homepage copy (hero, history, membership) | `index.html` |

Long-form editorial copy (club history, About Us, membership) stays in the page
templates; news articles live in `news/**` as described above.

Date and excerpt helpers are shared rather than re-implemented per page:
`tools/fixture-schedule.mjs` (parsing, build day, venue side),
`tools/news-dates.mjs` (one date style) and `tools/news-excerpts.mjs`
(sentence-level card excerpts).

## Generated content rules

- **Never read generated output back in.** `eleventy.config.js` ignores
  `_site*/**` and `.cache*/**`, and `tests/build-output.spec.js` fails if a
  nested `_site*` directory appears inside the artifact.
- **One source per fact.** Fixture state, news dates and card excerpts are
  computed once at build time; templates never do date arithmetic.
- **Test-only switches** (`FIXTURES_TEST_TODAY`, `FIXTURES_TEST_DATA`,
  `STAGE12_TEST_FIXTURES`, `SKIP_IMAGE_PIPELINE`) are read only when set, are
  never set by the deployment workflow, and mark their output with
  `data-test-fixtures` so a leak is detectable.

## JavaScript architecture

`script.js` is a single IIFE that exposes nothing globally and registers one
`DOMContentLoaded` handler calling feature-detected initialisers:
`initialiseMobileNavigation`, `initialiseSmoothScrolling`,
`initialiseKeyboardActivation`, `initialiseAccordions`, `initialiseCustomLightbox`
`initialiseThemeToggle`, `initialiseFixtureCollapse` and
`initialiseLightboxLibrary`. Each returns early unless its markup exists, so the
file is safe on every page.

Page-specific behaviour lives in the page template's inline `<script>`:
gallery album navigation (including the generated archive album), PhotoAlbum
generation (shared include), signup validation, live-scoring controls (expand,
exit and the unavailable fallback) and the cookie/privacy handling on
`contact.html`. Lightbox2 + jQuery remain in use for gallery and album pages.

The fixtures page has no date script: past/next state is baked into the markup
and `initialiseFixtureCollapse` only toggles what is already there. The
historical archive rail is pure CSS.

## Image pipeline

Originals stay in `Images/`; the build writes derivatives to `_site/Images/**`
and caches them in `.cache/images`. Full documentation, derivative sizes,
encoder settings, caching and the "add a photo" workflow live in
[docs/image-pipeline.md](docs/image-pipeline.md).

## Testing layers

| Layer | File | What it protects |
| --- | --- | --- |
| Structure & deployment | `tests/build-output.spec.js` | generated DOM vs the Stage 2A snapshot, source archive integrity, artifact size, no dev paths in `_site` |
| HTML validation | `tests/html-validation.spec.js` | html-validate findings against an accepted baseline |
| Internal links | `tests/internal-links.spec.js` | every `href`/`src`/CSS `url()` target, placeholder links |
| Image references | `tests/image-references.spec.js` | every image URL on every page returns 200 and renders |
| Interactions | `tests/javascript-interactions.spec.js` | nav, accordions, fixtures, galleries, lightboxes, forms, live scoring |
| Keyboard | `tests/keyboard-accessibility.spec.js` | keyboard operation, ARIA state, focus ring, reduced motion |
| Accessibility/SEO | `tests/page-audit.spec.js`, `tests/seo-metadata.spec.js` | console/page errors, failed requests, axe, page weights, titles/descriptions/canonical/OG/JSON-LD, sitemap and robots |
| News architecture | `tests/news-architecture.spec.js` | collection counts, landing composition, archives, homepage automation, date and title formatting |
| Fixtures UX | `tests/fixtures-ux.spec.js` | the four season states (built with a pinned date), the collapse control, the no-JavaScript fallback, mobile layout |
| Historical archive | `tests/historical-archive.spec.js` | chronology, year chapters, excerpts, uncropped imagery, cross-links |
| Live scores | `tests/live-scoring.spec.js` | the embed, the honest copy and the unavailable fallback |
| Navigation reliability | `tests/navigation-hit-target.spec.js`, `tests/rapid-navigation.spec.js`, `tests/external-dependency-resilience.spec.js` | hit targets across the font swap, rapid navigation, stalled third-party origins |
| Visual | `tests/visual-regression.spec.js` | screenshot comparisons for every audited page at desktop/tablet/mobile plus night desktop |

All comparisons run against accepted baselines under `reports/baseline/` and
`tests/__screenshots__/`; nothing updates them automatically (only
`npm run baseline:update` does). The browser clock is frozen in tests
(`tests/helpers/baseline-clock.mjs`) so date-dependent pages are deterministic.

Screenshot baselines are **per platform** — `…-<viewport>-<platform>.png`, via
the `{platform}` token in `playwright.config.js` — because Chromium rasterises
text with the platform's own font stack (DirectWrite/ClearType on Windows,
FreeType/fontconfig on Linux). The deployment gate runs on `ubuntu-latest`, so
the Linux set is the authority for it; the Windows set keeps local Windows runs
meaningful. The Linux set is produced by the manual, non-deploying
`.github/workflows/visual-baselines.yml` and reviewed before it is committed
(MAINTENANCE.md → *Visual baselines (platform-specific)*).

## Deployment flow

`.github/workflows/static.yml`: checkout → `configure-pages` → Node 22 with npm
cache → `npm ci` → Playwright Chromium → `npm test` (build + the full suite, the
release gate, which compares the visual baselines of the platform it runs on —
Linux) → upload `_site` as the Pages artifact → deploy. The archive (`Images/`),
`_data/`, `_includes/`, `tools/`, `tests/` and `reports/` are never uploaded;
only `_site` is. A second, manual workflow
(`.github/workflows/visual-baselines.yml`) only *generates* Linux baselines as an
artifact for review; it has no deploy or write permission.

## Cloud-synced working copies

OneDrive (and similar tools) can lock or dehydrate generated files. The build
therefore:

- copies derivatives rather than hard-linking them;
- retries transient filesystem errors with backoff;
- lets you redirect generated output with environment variables:

```powershell
$env:SITE_ROOT = "_site-alt"          # build output directory
$env:IMAGE_CACHE_ROOT = ".cache-alt"  # derivative cache directory
npm.cmd test
```

Both defaults (`_site`, `.cache/images`) remain in use when the variables are
unset, and both override directories are gitignored.
