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

Long-form editorial copy (news articles, history, About Us) deliberately stays in
the page templates.

## JavaScript architecture

`script.js` is a single IIFE that exposes nothing globally and registers one
`DOMContentLoaded` handler calling feature-detected initialisers:
`initialiseMobileNavigation`, `initialiseSmoothScrolling`,
`initialiseKeyboardActivation`, `initialiseAccordions`, `initialiseCustomLightbox`
and `initialiseLightboxLibrary`. Each returns early unless its markup exists, so
the file is safe on every page.

Page-specific behaviour lives in the page template's inline `<script>`:
fixtures date state, gallery album navigation (including the generated archive
album), news/history toggles and lightbox, PhotoAlbum generation (shared include),
signup validation, live-scoring controls and the cookie/privacy handling on
`contact.html`. Lightbox2 + jQuery remain in use for gallery and album pages.

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
| Visual | `tests/visual-regression.spec.js` | 54 screenshot comparisons at desktop/tablet/mobile |

All comparisons run against accepted baselines under `reports/baseline/` and
`tests/__screenshots__/`; nothing updates them automatically (only
`npm run baseline:update` does). The browser clock is frozen in tests
(`tests/helpers/baseline-clock.mjs`) so date-dependent pages are deterministic.

## Deployment flow

`.github/workflows/static.yml`: checkout → `configure-pages` → Node 22 with npm
cache → `npm ci` → `npm run build` → `npm test` (release gate) → upload `_site`
as the Pages artifact → deploy. The archive (`Images/`), `_data/`, `_includes/`,
`tools/`, `tests/` and `reports/` are never uploaded; only `_site` is.

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
