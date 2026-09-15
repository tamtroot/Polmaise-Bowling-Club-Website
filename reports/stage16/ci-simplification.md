# CI simplification — a proportionate release gate

The site serves a club of ~60 members. Repeated deployments failed on
environment-specific rendering (font metrics, platform screenshots) rather than
on anything a visitor would notice, so the release gate now blocks only on
real user-visible breakage or on the site failing to build and deploy.

Nothing was redesigned, no layout changed, and no test was deleted: the heavy
suites were reclassified as optional QA and the gate is a new lean suite.

## Old gate vs new gate

| | Old | New |
| --- | --- | --- |
| Command | `npm test` (build + the full suite) | `npm run build` + `npm run test:ci` |
| Tests | 537 test slots (326 ran, 211 skipped) | 42 slots (31 ran, 11 project-conditioned skips) |
| Local runtime | ~5.9 min | **~0.85 min** (31 passed, 11 skipped) |
| CI runtime | ~15.5 min (last run: 15m29s, failing on screenshots) | ~5–6 min (≈4 min cold image build + ≈1 min gate) |
| Blocked by screenshots | Yes — Windows-captured PNGs never match the Linux runner | **No** — the gate never compares screenshots |
| Blocked by font rasterisation | Yes (fallback metrics, anti-aliasing) | **No** |
| Blocked by click-stress / matrices | Yes | **No** (optional) |

## What the gate blocks on

`npm run test:ci` = `tests/ci-gate.spec.js` + `tests/build-output.spec.js` +
`tests/internal-links.spec.js` + `tests/javascript-interactions.spec.js`, run on
the desktop and mobile projects (`--project=desktop --project=mobile`).

| Mandatory check | Implemented by |
| --- | --- |
| Build completes and `_site` holds the expected pages, sitemap, robots, styles and script; no source tree, tooling or reports leak into the artifact | `tests/ci-gate.spec.js`, `tests/build-output.spec.js` |
| Representative pages load and render: home, fixtures, news, a current news article, historical archive, gallery, membership, history, contact — HTTP 200, a visible `<main>`, no uncaught JavaScript errors, no missing script/stylesheet, no image that failed to load | `tests/ci-gate.spec.js` |
| Navigation: desktop links visible and navigating, mobile drawer opens and follows a link, theme toggle switches and switches back | `tests/ci-gate.spec.js`, `tests/javascript-interactions.spec.js` |
| Links and images: every `href`/`src`/CSS `url()` target resolves; representative-page images actually render | `tests/internal-links.spec.js`, `tests/ci-gate.spec.js` |
| Responsive sanity at 1440px and 375px: no horizontal overflow (> 1px), a usable `<main>`, no overlapping header controls | `tests/ci-gate.spec.js` |
| Accessibility: axe on five representative page/width combinations (home desktop, home mobile, fixtures mobile, news article desktop, contact mobile) — a **new** serious/critical finding blocks; the findings the full audit already records are logged | `tests/ci-gate.spec.js` |
| Structure/metadata: one `<main>`, one `<h1>`, title, meta description, canonical and `lang`; `sitemap.xml` (200, ≥ 20 entries) and `robots.txt` served | `tests/ci-gate.spec.js` |
| Core interactions: accordions, gallery albums, lightbox, news cards, archive links, PhotoAlbum rendering, signup validation, live-scoring controls | `tests/javascript-interactions.spec.js` |
| Artifact integrity: image derivatives rather than the full-resolution archive, publishable artifact size | `tests/build-output.spec.js` |

## What moved out of the gate (kept, not deleted)

| Suite | Now runs via | Why it is not release-blocking |
| --- | --- | --- |
| Visual screenshots | `npm run test:visual` | Windows-captured PNGs versus Linux rasterisation: a pixel diff says nothing about a visitor |
| Platform-specific baselines + the manual *Generate Linux visual baselines* workflow | removed | with the visual suite out of the gate, no deployment needs Linux baselines |
| Font-swap movement (`tests/navigation-hit-target.spec.js`) | `npm run test:diagnostic` | exact font metrics are a portability concern, not a visitor-facing defect (the practical navigation checks stay in the gate) |
| 100/rapid click stress (`tests/rapid-navigation.spec.js`) | `npm run test:diagnostic` | stress behaviour, not core function |
| Stalled-origin resilience (`tests/external-dependency-resilience.spec.js`) | `npm run test:diagnostic` | robustness under synthetic stalls |
| Page audits, SEO metadata equality, keyboard, theme, homepage/fixture-state builds, news architecture, historical archive, live scores, html-validate, image references on every page, image-deployment structure snapshot | `npm test` (full suite) | exhaustive matrices and regression detail; the gate covers the representative cases |
| Visual capture / layout / diff tooling (`tools/capture-*`, `compare-layout`, `analyse-visual-diff`) | manual | design-review tools |

All of these files are still in the repository and still run in `npm test`, so
nothing was thrown away.

## Scripts and workflow

```jsonc
"test":             "npm run build && playwright test",              // full suite (optional)
"test:ci":          "playwright test <lean specs> --project=desktop --project=mobile",
"test:visual":      "playwright test tests/visual-regression.spec.js",
"test:diagnostic":  "playwright test tests/navigation-hit-target.spec.js tests/rapid-navigation.spec.js tests/external-dependency-resilience.spec.js",
```

`.github/workflows/static.yml` now runs: checkout → `configure-pages` → Node 22
with npm cache → `npm ci` → `npx playwright install --with-deps chromium` →
`npm run build` → `npm run test:ci` → upload `_site` → deploy. Chromium is kept
because the lean suite is a browser smoke test. The workflow has no
screenshot/baseline step, so a font or anti-aliasing difference on Ubuntu can no
longer block a deployment.

## Verification

| Check | Result |
| --- | --- |
| Lean gate (`npm run test:ci`, after a build) | **31 passed, 11 skipped, 0 failed — 48.9s** |
| Full suite (`npx playwright test`) | **332 passed, 223 skipped, 0 failed — 7.4 min** (the gate's six checks now run inside the full suite too, hence 332/7.4 min versus the pre-change 326/5.9 min) |
| Gate composition | 4 spec files block; the other 17 are retained as optional/diagnostic |
| Screenshot tolerance | unchanged (`threshold: 0.2`, `maxDiffPixelRatio: 0.002`, `animations: "disabled"`) — the visual suite simply is not in the gate |
| Website changes | none |

## Remaining release risks (accepted)

- A purely visual regression (a CSS change that breaks the look but not the
  structure) is no longer caught by the deployment. It is caught by
  `npm run test:visual` / `npm test` when someone runs them, and by the
  representative layout checks in the gate (overflow, `<main>`, header overlap).
- The Stage 2A DOM-structure snapshot and the exhaustive page/theme matrices no
  longer block; a change that alters every page's markup would reach production
  if the optional suite is not run.
- The pre-existing serious colour-contrast findings (footer headings, fixtures
  table) remain recorded in the full audit; the gate logs rather than re-fails
  them, and a *new* serious/critical finding still blocks.
- Images and links are checked on the representative page set plus every
  `href`/`src`/`url()` target; a broken image only on an unvisited page is caught
  by the optional `image-references` spec.

## Files changed

| File | Change |
| --- | --- |
| `tests/ci-gate.spec.js` | new lean release gate (build output, page smoke, navigation, responsive sanity, representative axe, structure/metadata/sitemap) |
| `tests/build-output.spec.js`, `tests/internal-links.spec.js`, `tests/javascript-interactions.spec.js` | unchanged; now selected by `test:ci` |
| `package.json` | `test:ci` and `test:diagnostic` added; `test` stays the full suite |
| `.github/workflows/static.yml` | `npm test` → `npm run build` + `npm run test:ci` |
| `.github/workflows/visual-baselines.yml` | deleted (Linux baselines are no longer required) |
| `tools/compare-visual-baselines.mjs` | deleted (existed only to reconcile platforms) |
| `tools/analyse-visual-diff.mjs` | reverted to the platform-free baseline lookup |
| `playwright.config.js` | platform token removed; the visual suite documented as optional QA |
| `tests/__screenshots__/**` | baseline names reverted to `<page>-<viewport>.png` (content byte-identical) |
| `MAINTENANCE.md` | new *What blocks a release* section (classification, sanity check) replacing the platform-baseline section |
| `README.md`, `ARCHITECTURE.md`, `RELEASE.md` | gate, scripts and runtime updated; visual baselines documented as optional Windows QA |
| `reports/stage16/visual-baseline-strategy.md` | deleted (superseded by this cleanup) |
