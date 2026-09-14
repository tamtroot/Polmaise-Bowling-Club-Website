# Stage 10 — visual restoration, navigation reliability and premium polish

Stage 9's architecture (semantic tokens, dual themes, axe-clean accessibility)
is untouched. Stage 10 fixes the reported defects at their source and refines
the visual system.

## 1. Navigation freeze — root cause and fix

**Root cause (primary).** Every page loaded four third-party origins in its
critical path:

| Asset | Where it came from | How it blocked |
| --- | --- | --- |
| jQuery 3.6.0 | cdnjs | parser-blocking `<script>` in `<head>` |
| Lightbox2 2.11.3 | cdnjs | parser-blocking `<script>` in `<head>`/end of body |
| Font Awesome 6.4.2 CSS + webfonts | cdnjs | render-blocking `<link rel="stylesheet">` (plus 2 webfonts) |
| Merriweather / Open Sans / Playfair Display | fonts.googleapis.com + fonts.gstatic.com | render-blocking `<link rel="stylesheet">` + webfonts |

The page's own `script.js` runs at the end of the body, and the stylesheets
block the first paint, so while one of those requests was in flight the new
document could neither paint nor run its interactions. Rapid navigation makes
that worse: each new document re-issues those requests, so a slow or throttled
CDN (a very common condition on club Wi-Fi) leaves the browser showing the
previous page or a blank one, with clicks doing nothing until the request
resolves — the "frozen until you refresh" report.

**This was reproduced deterministically** before any fix: with the third-party
origins delayed by 8 s, `/index.html` never reached first-contentful-paint
within 4 s (`tests/external-dependency-resilience.spec.js`, first test).

**Root cause (secondary).** `body.menu-open { overflow: hidden }` is the mobile
drawer's scroll lock. It was cleared only by click handlers plus a resize
handler that still tested the pre-Stage-9 `992px` breakpoint, so the drawer
state could outlive the layout (for example when a page was restored from the
back/forward cache) and leave the page unable to scroll at all — another way
the site could look frozen with no way out but a refresh.

**Fixes.**

1. All critical-path assets are now **self-hosted** in `vendor/` and copied by
   the build (`tools/fetch-vendor-assets.mjs` regenerates them):
   * `vendor/fontawesome/` — CSS trimmed to the two faces the site uses
     (`fa-solid-900`, `fa-brands-400`); regular and v4-compatibility faces and
     the `.ttf` fallbacks are removed.
   * `vendor/fonts/` — Merriweather 400/700, Open Sans 400/600 and Playfair
     Display 400/700/900, latin subset only (the content is UK English; the
     only non-ASCII characters are £ × ‑ – — ’ “ ” •).
   * `vendor/jquery/`, `vendor/lightbox2/` — JavaScript, CSS and the Lightbox2
     control images.
   776 KiB of vendor assets, of which ~640 KiB is fetched on a page load.
2. `script.js` now drives the drawer from the same media query the CSS uses
   (`min-width: 1280px`) and resets the drawer state on `pageshow`/`pagehide`,
   so the scroll lock can never outlive the drawer. The mobile dropdown links
   also close the drawer.
3. Two permanent regression tests:
   * `tests/external-dependency-resilience.spec.js` — throttles every
     third-party origin by 8 s and requires the page to paint and stay
     interactive; plus a check that no page loads scripts, styles or fonts from
     a third-party origin (embedded iframes excepted).
   * `tests/rapid-navigation.spec.js` — clicks through all nine navigation
     targets twice with no waiting, then proves each arrival is alive (document
     reaches DOMContentLoaded, the theme control reacts, the page scrolls),
     that the drawer never arrives stuck open, and that a history restore never
     returns with a locked scroll state.

**Measured before/after** (`tools/audit-navigation-timing.mjs` walks the site
like a user; the rapid-navigation test reports its own timings):

| Check | Before | After |
| --- | --- | --- |
| Page paint while third-party origins are stalled | never (test failed) | first paint < 600 ms |
| DOMContentLoaded per hop (`tools/audit-navigation-timing.mjs`) | n/a | 16–48 ms |
| Whole hop including click and parse | n/a | 116–220 ms |
| Rapid navigation, 18 hops, desktop | 422 ms slowest hop | 385 ms slowest hop |
| Rapid navigation, 18 hops, mobile | stalled (test could not complete) | 3.2 s slowest hop including opening the drawer |
| Slowest interaction while hopping | n/a | 90 ms |
| Third-party origins in the critical path | 4 | 0 |

## 2. Active navigation style

The active item no longer becomes a filled block. It is now the club navy text
colour plus a 2px inset accent rule that grows from the centre; hover uses the
same rule, so the two states are related but distinguishable. The rule is
removed inside the mobile drawer, where the active item is simply accented.
The Stage 9 collision fixes and the 1280px breakpoint are unchanged
(`tools/audit-header-layout.mjs`: 396 checks, 0 problems).

## 3. Club wordmark typography

The wordmark now uses Playfair Display 700 (self-hosted, already required by
the Presentation Dance page), set as a two-line mark —
*Polmaise* / *Bowling Club* — with `text-wrap: balance`, a fine brass rule
underneath and a deep navy colour. It is a deliberate clubhouse treatment
rather than a generic sans heading, and because the balanced two-line mark is
narrower than the previous single line it also removes the header collision at
1280–1440px that a wider single-line serif reintroduced.

## 4. Hero call-to-action buttons

Call-to-action buttons over photography are solid again:

* Primary: solid `--color-primary` with `--color-on-primary` text, wider
  padding, `--shadow-md` — it dominates the row.
* Secondary: solid `--color-inverse-button-bg` (`rgba(255,255,255,0.94)`) with
  dark ink, identical in both themes because the photograph behind them does
  not change. This is what removes the "outline text over a busy photo"
  legibility problem.

All buttons now have a 44px minimum height, so the touch target is consistent.

## 5. Footer

The footer is a royal navy anchor again in the day theme
(`--color-footer-bg: #16307A`) and a darker related tone at night
(`#101725`). Brass section headings, light blue-grey body text, translucent
white icon buttons and a hairline above the copyright line. All of it is
tokenised, and contrast is checked by the axe gate (0 violations in both
themes).

## 6. Logo defect

**Root cause.** `Images/club-logo.png` was a circular crest drawn on a **fully
opaque white square** (every pixel alpha 255, corners pure white) at only
110×110px, and the homepage displayed it in a 150px slot.

* Because the square was opaque, the crest rendered as a white box in the night
  theme — the visible "logo display issue".
* Because the source is 110px, the 150px homepage slot and DPR ≥ 2 displays
  upscaled it, which is why it looked soft. (The Stage 6 image pipeline
  deliberately never upscales, so the derivatives were all 110px.)

**Fixes.** `tools/normalise-club-logo.mjs` masks everything outside the badge
circle (the badge is a 94px circle centred in the canvas, so the mask uses its
own geometry) leaving the canvas size and crest position untouched — no layout
shift — and the file dropped from 90,572 to 6,059 bytes. The homepage
`.welcome-logo` slot is now 110px (88px on mobile) so the crest is never scaled
beyond its real resolution. Verified in both themes at desktop/tablet/mobile
and at DPR 1/2/3 via `tools/audit-social-icons.mjs` and the capture set.

## 7. Facebook icon

**Root cause.** The Facebook anchor had no class, so the Stage 9 generic rule
`.container a:not([class])` (specificity 0,2,1) out-ranked
`.social-links a` (0,1,1) and painted the glyph in the same navy as its circle:
measured glyph `rgb(22,48,122)` on circle `rgb(22,48,122)` — invisible. The
decorative Twitter/Instagram/YouTube spans were unaffected because they carry
the `social-link` class.

**Fix.** The over-specific generic selector is gone (bare links still inherit
the base `a` colour, so nothing else changes), and the icon uses
`fa-facebook-f` — the standalone "f" glyph — instead of `fa-facebook`, whose
"f" is negative space inside a tile. `tools/audit-social-icons.mjs` now proves
all four icons: white glyphs on translucent white circles in both themes
(light: `rgb(255,255,255)` on `rgba(255,255,255,0.14)`).

## 8. Premium polish

Contained refinements only; the information architecture and day-theme
structure are unchanged:

* tighter heading leading and a 62ch measure for section intros;
* a hairline between stacked sections instead of bands or gradients;
* prose links with 1px underlines and 2px offsets;
* consistent 44px controls, softer card hover shadows (`--shadow-sm`),
  unchanged corner radii;
* brass (`--color-brass`) used sparingly — the wordmark rule and footer
  headings — alongside royal navy and sky blue.

No glassmorphism, no neon, no new animation.

## 9. Verification

| Gate | Result |
| --- | --- |
| Full Playwright suite | **188 passed, 0 failed, 91 skipped** (exit code 0) |
| axe, day/night × desktop/mobile, 18 pages | **0 violations in all four passes** |
| Header collision probe (18 pages × 11 widths × 2 themes) | **396 checks, 0 problems** |
| Rapid navigation (desktop + tablet + mobile) | passing, all hops responsive |
| Third-party resilience | passing (paint < 600 ms with CDNs stalled; 0 third-party critical assets) |
| Social icons | 4/4 visible in both themes, verified by screenshot and computed colour |
| Visual review diagnostics (92 captures) | night white islands **0**, unintended legacy hues **0**, horizontal overflow **0**, broken images **0**, page errors **0**, console errors **3** (all the accepted Live Scoring 401) |

## 10. Comparison with the Stage 9 baseline

The Stage 9 baseline was archived to `reports/baseline/visual/stage9/`
(72 images; Stage 8 remains in `reports/baseline/visual/stage8/`), then the
Stage 10 baseline was recorded.

Quantified with `tools/analyse-visual-diff.mjs` against the Stage 9 images:
71 of 72 captures differ, mean 176,537 differing pixels (≈13.6% of a
1440×900 viewport) with a mean channel delta of 114/255. The intentionally
changed regions are, in order of size:

1. the header — transparent crest, two-line Playfair wordmark with brass rule,
   underlined active navigation instead of a filled pill;
2. the footer — royal navy in day, dark navy at night, brass headings;
3. hero call-to-action buttons — solid instead of outline;
4. subtle typographic and separator refinements on inner sections.

The smallest differences are the Presentation Dance article (10,434 pixels at
desktop night — it was already tokenised in Stage 9 and only inherits the
header/footer changes) and the tablet home page (39,511 pixels, mostly the
header). No page-level layout, content or information architecture was
changed.

## 11. Performance

| Asset | Stage 9 | Stage 10 |
| --- | --- | --- |
| `styles.css` (source) | 41,782 B | 46,405 B |
| `script.js` (source) | 8,189 B | 9,368 B |
| Self-hosted vendor assets | 0 (4 third-party origins) | 776 KiB in `vendor/` (17 files) |
| Homepage transferred | see note | 946 KB / 14 requests |

**Note on the homepage figure.** The Stage 9 measurement (391 KB / 7 requests)
only counted same-origin bytes: cross-origin responses report `transferSize 0`
to resource timing, so the CDN copies of Font Awesome, its webfonts and the
Google fonts were not included. The assets were always downloaded — they are
simply visible now. The equivalent Stage 9 figure, adding the CDN payloads
(Font Awesome CSS 102 KB + webfonts 260 KB + Google fonts ≈ 326 KB), was
≈1,088 KB; Stage 10 serves 946 KB with **no third-party origins in the critical
path**, latin-ext and the unused Font Awesome faces removed, and the crest file
reduced from 90 KB to 6 KB.

## 12. Remaining visual debt

1. The Font Awesome solid webfont (147 KB) carries ~2,000 icons for the ~35 the
   site uses; a subset build would need a font toolchain.
2. The crest source is still only 110px. A larger original from the club would
   make DPR 3 rendering crisp without any upscaling.
3. The night honours boards still use the warm walnut/brass heritage tokens
   described in the Stage 9 report (intentional, 11.5:1 contrast).
4. Status badges keep conventional green/amber; they can be re-tinted through
   the existing status tokens if the club prefers a strictly blue palette.
5. The `fontFamilies` front matter key in the page templates is now unused (all
   pages load the same self-hosted `vendor/fonts/fonts.css`); it is harmless but
   can be removed when those pages are next edited.

## 13. Git diff summary

105 tracked files changed (+4,339 / −1,954) plus new files:

* templates and build: `_includes/head.njk`, `_includes/footer.njk`,
  `_includes/scripts.njk`, `eleventy.config.js`, `index.html`,
  `News articles/presentation-dance-2025.html`;
* `styles.css`, `script.js`;
* `vendor/` (17 self-hosted assets);
* tests: `tests/external-dependency-resilience.spec.js`,
  `tests/rapid-navigation.spec.js`, `tests/build-output.spec.js`;
* tools: `tools/fetch-vendor-assets.mjs`, `tools/normalise-club-logo.mjs`,
  `tools/audit-social-icons.mjs`, `tools/audit-navigation-timing.mjs`,
  `tools/audit-header-layout.mjs` (wordmark metrics + filtering),
  `tools/capture-stage9-visuals.mjs` (page filter, accepted brand colours);
* baselines and reports: the Stage 10 visual baseline, the archived Stage 9
  baseline, the refreshed source-image manifest (`Images/club-logo.png`), and
  `reports/stage10/`.
