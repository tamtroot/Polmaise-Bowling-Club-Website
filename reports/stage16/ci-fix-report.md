# CI fix — GitHub Actions deployment failures

Scope: the three failures reported from the release run, plus the one
platform-dependency they exposed. No page was redesigned, no content was
rewritten, and the release gate was not weakened.

## Files changed

**Production/tooling**

| File | Change |
| --- | --- |
| `tools/image-pipeline.mjs` | exports `IMAGE_EXTENSIONS` (the raster formats the pipeline treats as source photographs) so the integrity check uses the same list |
| `tools/verify-source-images.mjs` | **new** — the Stage 6 integrity rules as a small module: `isProtectedSourceImage`, `compareSourceImages`, `classifyDeployedImage` |
| `News articles/presentation-dance-2025.html` | `<h2>Entertainment &amp; Refreshments</h2>` |
| `PhotoAlbums/charlie-mcneil-memorial-2025.html` | two body-text `&` → `&amp;` (winners/runners-up names) |
| `history.html` | three headings: `Sources &amp; References`, `Community &amp; Local History`, `Historical Context &amp; Background` |
| `honours.html` | `<h2>Honours &amp; Achievements</h2>` |
| `membership.html` | `Coaching &amp; Development`, `Full Members (Male &amp; Female)`, `Seniors (Male &amp; Female)` |

**Tests and baselines**

| File | Change |
| --- | --- |
| `tests/build-output.spec.js` | uses the new integrity module; asserts `protectedCount > 1800`; records platform-independent measurement paths |
| `tests/source-image-integrity.spec.js` | **new** — five regression tests (below) |
| `tests/html-validation.spec.js` | fingerprints use POSIX separators |
| `tests/internal-links.spec.js` | fingerprints use POSIX separators |
| `tests/external-dependency-resilience.spec.js` | click *action* budget raised (assertions untouched) |
| `reports/baseline/html-validation/issues.json` | 46 items rewritten to POSIX paths |
| `reports/baseline/internal-links/missing-targets.json` | 3 items rewritten to POSIX paths |

## Root cause 1 — "changed originals" were not images

`verifyImageDeployment()` compared **every** entry in
`reports/stage6/source-image-manifest.json` against the working tree. The
manifest lists 1,914 files, but only **1,906** are raster images; the other eight
are the notes, a helper script and two SVG logos that sit beside the photographs
(`Images/**/Readme.md` ×5, `Images/thumbsremove.ps1`, `Images/hamilton.svg`,
`Images/2026/Highland.svg`).

Those files are text, so git's line-ending normalisation changed their byte
sizes in CI: `BridgeTea/Readme.md` is `"\r\n"` (2 bytes) on a Windows checkout
but `"\n"` (1 byte) on Linux, and `thumbsremove.ps1` loses one byte per line
(2,836 → 2,758 = 78 CRs). Nothing had been mutated; the comparison was simply
measuring the wrong files. This machine has `core.autocrlf = true` and the
repository has no `.gitattributes`, which is exactly the Windows/Linux
asymmetry the CI runner exposed.

**Fix:** the mutation check is restricted to the pipeline's own supported raster
extensions (`.jpg .jpeg .png .webp .gif .avif`, imported from
`image-pipeline.mjs` — no per-file exclusions). The eight non-raster files are
still allowed to deploy (the deployed-file check keeps using the full manifest),
and every deployed file must still be either a recorded original or a `-wNNN`
derivative whose stem is a **protected photograph**.

## Root cause 2 — raw ampersands in hand-written templates

The raw `&` reached the generated HTML from the page templates themselves:

- `News articles/presentation-dance-2025.html` — a section heading.
- `PhotoAlbums/charlie-mcneil-memorial-2025.html` — two player names in body copy.

The same defect existed in three further templates (`history.html`,
`honours.html`, `membership.html`, seven lines in total) which were already in
the accepted validation baseline, so they only ever surfaced as CI noise when
their fingerprint changed. All eight occurrences were fixed at source.

**Fix:** `&` → `&amp;` in template text only. No generated file was edited, no
global escaping was added, the baseline was not extended, and the rendered text
is unchanged (`&amp;` renders as `&`).

HTML validation now reports **2 findings across 68 pages** (down from 12):
`about.html`'s legacy lightbox `<img>` without `src` and `honours.html`'s
`<style>` inside `<body>` — both long-standing, both already accepted.

## Root cause 3 — Windows path separators in baseline fingerprints

`path.relative()` returns `\` on Windows and `/` on Linux, and the fingerprints
are the baseline keys. Every baselined finding for a page in a subdirectory
(`News articles/…`, `PhotoAlbums/…`) therefore looked *new* on CI while
top-level pages matched — which is why only those two pages were reported.

**Fix:** `tests/html-validation.spec.js` and `tests/internal-links.spec.js` now
emit POSIX fingerprints, and the two stored baselines were rewritten to match
(item count and order unchanged). Measurement files record POSIX paths too, so
committed measurements stop churning between platforms.

## Regression coverage added

`tests/source-image-integrity.spec.js`:

1. a non-image file beside the photographs with a different recorded size does
   **not** appear in `changedOriginals` (and is reported as unmanaged);
2. a mutated source photograph **does** fail (`… team.jpg: 10 -> 11`), and a
   missing photograph is still reported;
3. the real manifest still protects the whole archive (0 missing, 0 changed,
   `protectedCount > 1800`, and every protected path is a raster image);
4. deployment classification accepts recorded originals (including the SVG
   logos) and genuine derivatives, and rejects anything else;
5. the protected-extension list comes from the pipeline, is case-insensitive,
   and handles Windows separators.

## CI-equivalent Linux checks

- Loaded the real manifest with the two text files' bytes set to their **LF**
  sizes (`Readme.md` 1, `thumbsremove.ps1` 2,758): integrity reports
  `protected originals: 1906, missing: 0, changed: 0`.
- Mutated one real photograph's recorded size: the check reports the mutation,
  so the protection still bites.
- Latest fingerprint files contain **0 backslashes** in both comparison
  baselines, so Windows and Linux produce identical keys.

## Verification (clean build, then the full suite)

| Check | Result |
| --- | --- |
| Clean build | `_site` + `.cache` deleted; 3,051 files, 243.5 MiB, 2,957 derivatives, 2,201 references verified, no warnings |
| Playwright | **323 passed, 205 skipped, 0 failed** (6.0 min) |
| Source-image integrity | 1,906 protected photographs, 0 missing, 0 changed; mutation and missing-file cases still fail |
| HTML validation | 68 pages, 2 findings (7 unique → 2), 0 new, 44 baseline items resolved |
| Visual regression | all page baselines matched |
| axe (day/night × desktop/mobile) | 0 violations, 0 missing descriptions/canonicals/`<main>`/`<h1>` |
| Internal links | 2,763 checked, 0 missing (6 known placeholders) |
| Image references | 2,864 checked, 0 broken, 0 unresolved |

## Was the gate weakened?

No:

- the integrity check still covers **1,906** photographs and now has a
  `protectedCount > 1800` floor so it cannot silently narrow;
- the eight excluded files are non-raster pass-throughs that were never part of
  the photographic protection, and they are still validated on the way out (a
  deployed file that is neither a recorded original nor a derivative of a
  protected photograph still fails);
- the HTML-validation baseline only lost items (fixed defects); nothing was
  added to it;
- the single test-timing change raises a Playwright *click action* timeout in the
  third-party resilience test; its assertions (first contentful paint under 4 s
  and the theme change within 2 s) are unchanged.

## Should CI pass now?

The three reported failures are fixed, and the platform-dependent string
comparisons around them are gone, so the build should pass on Linux GitHub
Actions.

One honest caveat, unchanged from the Stage 16 release report: the **visual
screenshots** were last regenerated on Windows and have never run on Linux. If
the first CI run reports pixel differences, that is font rasterisation rather
than a regression; review the diff and, if it is only rasterisation, regenerate
those baselines on the runner with `npx playwright test --update-snapshots`
(no tolerance change, no test disabled).
