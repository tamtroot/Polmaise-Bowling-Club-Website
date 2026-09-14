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
npm test              # build + the full Playwright suite
npm run test:build    # structure and deployment checks
npm run test:html     # html-validate against the accepted baseline
npm run test:links    # internal links, CSS references, placeholders
npm run test:visual   # 54 screenshot comparisons (desktop/tablet/mobile)
npm run test:audit    # console errors, failed requests, axe, page weights
```

Audit helpers:

```powershell
node tools/audit-accessibility.mjs     # axe + semantics/metadata audit per page
node tools/audit-repository.mjs        # dead selectors, JS hooks, page inventory
node tools/capture-layout.mjs before   # geometry fingerprint (all pages/viewports)
node tools/compare-layout.mjs before after
```

## Deployment

GitHub Pages, via `.github/workflows/static.yml`: `npm ci`, `npm run build`, the
test gate, then upload `_site`. Details and rollback steps are in
[RELEASE.md](RELEASE.md).

## Image pipeline

Original photographs in `Images/` are the club archive. They are never modified
and are not deployed; the build generates WebP derivatives sized for their
rendered role. See [docs/image-pipeline.md](docs/image-pipeline.md).

## Data architecture

Repeated structured content lives in `_data/`: fixtures, honours, gallery
albums, archive items, PhotoAlbum metadata and sponsors. Page templates loop
over those files. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Editing content

Step-by-step instructions for adding fixtures, news, gallery photos, honours,
sponsors and images are in [MAINTENANCE.md](MAINTENANCE.md).

## Colour scheme and typography

Recorded here because the Stage 9 visual redesign will need it:

- Club Blue `#1E3A8A`, Light Blue `#4B71BF`, Dark Blue `#0F2557`, Navy `#091534`
- Dark Gray `#333333`, Light Gray `#E5E7EB`, Error Red `#FF3860`
- Accessibility-adjusted values: footer headings `#a8c1f2` on club blue
  (5.71:1), past fixtures `#6a6a6a` on `#f5f5f5` (4.96:1), mobile fixture
  badges `#2e7d32` (Confirmed) and `#b45309` (Proposed) with white text
- Headings: Merriweather (serif). Body: Open Sans (sans-serif)
