# CI fix — Linux font-swap portability (navigation hit targets)

Scope: the remaining Stage 11 portability defect that failed
`tests/navigation-hit-target.spec.js` on GitHub Actions. No threshold was
changed, no test was disabled, `font-display: swap` is untouched, no CDN was
added, and the accepted navigation design is unchanged where the fonts resolve.

## Files changed

| File | Change |
| --- | --- |
| `styles.css` | the three `@font-face` rules that shared the name `'Open Sans Fallback'` became four single-face families; a calibrated `Liberation Sans` face was added for Linux; `--font-ui` lists them before the generic families; the desktop wordmark box is pinned |
| `tests/navigation-hit-target.spec.js` | two new guards (calibrated fallback must resolve on the running platform; the wordmark box must not change width, including with a forced narrow serif) |
| `tools/diagnose-navigation-lock.mjs` | the `--fontshift`/`--inventory` diagnostics read the new family names and report which one resolved |
| `MAINTENANCE.md` | the header-breakpoint section now documents the per-platform faces, the Linux face and the wordmark pin |

(Two temporary diagnostic scripts used for the measurements were deleted.)

## Root cause (three parts, all measured)

### 1. The per-platform fallback faces were never reached on Linux

The three Stage 11 rules all declared `font-family: 'Open Sans Fallback'`.
Several `@font-face` rules with the same family name do not form a fallback
chain — the cascade keeps the **last** one — and all three used `local()` with
Windows/macOS family names. `local()` requires an exact family match (fontconfig
aliases are not applied), so on Linux none of them resolved and the navigation
was painted in whatever generic sans the distribution provides.

Measured locally: the pre-swap navigation width matches **Arial at 107% exactly**
(total width error 0.00px over the nine labels), i.e. Windows/macOS were already
using the Arial face and the Segoe UI/Tahoma values were dead code.

### 2. The generic Linux sans is far wider than Open Sans

The CI numbers invert cleanly: consecutive movement values differ by the width
change of the label between them, so the per-label ratios against Open Sans are
107.8%, 111.2%, 111.4%, 113.9%, 115.3%, 112.7%, 111.8%, 111.4% — a mean of
**111.94%**. No installed Windows/macOS face is remotely that wide (Verdana
102.5%, Arial 94.6%, Segoe UI 93.0%, Tahoma 92.1%), so the CI fallback was an
unnamed wide generic sans. With a right-aligned row, a 12% width penalty on the
labels to the right of "Home" is the 85.78px drift.

`npx playwright install --with-deps` (which the workflow runs) installs
`fonts-liberation` — verified in the installed Playwright bundle
(`node_modules/playwright-core/lib/coreBundle.js` lists `fonts-liberation`
alongside `fonts-freefont-ttf`, `fonts-unifont`, `fonts-wqy-zenhei`,
`fonts-ipafont-gothic`, `fonts-tlwg-loma-otf` and `fonts-noto-color-emoji`).
There is no DejaVu package in that list, so the *specific* generic font can only
be confirmed on the runner — which is exactly why the fix names the family
instead of trusting the default, and why the new guard prints the family it
found (`[nav-guard] calibrated fallback in effect: …`).

### 3. The wordmark shrank, moving the whole menu

The last item in the CI report (Honours, 6.13px) has nothing to its right, so it
is the *common* shift: the logo block changed width. The wordmark stack is
`'Playfair Display', 'Merriweather', Georgia, 'Times New Roman', serif`; on
Linux the two web fonts are not loaded during the swap, Georgia is absent, and
fontconfig's aliases turn `Times New Roman` into the **narrower Liberation
Serif** — measured locally at 192.8px against Playfair's 200px cap, i.e. the
logo loses ~7px and every navigation item moves with it.

## Fix

1. **One family per platform face** (predictable, ordered, cascade-proof):

   | Family | Source | size-adjust | Worst nav shift |
   | --- | --- | --- | --- |
   | `'Open Sans Fallback Arial'` | `local('Arial')` | 107% | 2.70px (measured) |
   | `'Open Sans Fallback Segoe'` | `local('Segoe UI')` | 109.75% | 1.44px (measured) |
   | `'Open Sans Fallback Tahoma'` | `local('Tahoma')` | 110.75% | 1.66px (measured) |
   | `'Open Sans Fallback Liberation'` | `local('Liberation Sans')` | 107% | takes Arial's value |

   All four carry Open Sans' own vertical metrics
   (`ascent-override: 106.88%`, `descent-override: 29.29%`,
   `line-gap-override: 0%`). Arial stays first so Windows/macOS keep exactly the
   face they used before (measured pre-swap width error 0.00px); Liberation Sans
   is metric-compatible with Arial by design, so it inherits the *measured*
   107% rather than a copy of the Windows calibration. Linux therefore paints
   the labels with a measured face (~2.7px worst) instead of the 112%-wide
   generic (85.78px).

2. **The wordmark box is pinned** (`width: 10em` in the existing
   `@media (min-width: 1280px)` block, where the logo already has
   `flex-shrink: 0`). The wordmark already renders at exactly that width, so
   nothing changes visually — but the logo can no longer change width when a
   different serif stands in for Playfair Display. Applied only at the width
   where the inline navigation exists, so small screens keep the flexible logo.

3. **Guards** in `tests/navigation-hit-target.spec.js`: a calibrated fallback
   family must resolve on the running platform (fails instead of silently
   drifting when a platform's faces are missing), the faces must keep their
   `size-adjust` and metric overrides and stay ahead of the generic families in
   `--font-ui`, and the wordmark box must not change width across the swap nor
   when a narrow serif is forced in.

## Measurements

Navigation movement, this machine (fallback → webfont), worst of the nine items:

| Viewport | Theme | Before fix | After fix |
| --- | --- | --- | --- |
| 1440px | light | 2.70px | **2.70px** |
| 1440px | dark | 2.70px | **2.70px** |
| 1280px | light | 2.70px | **2.70px** |
| 1280px | dark | 2.70px | **2.70px** |
| 1024px | light (drawer) | 0.00px | **0.00px** |
| 1024px | dark (drawer) | 0.00px | **0.00px** |

(Windows behaviour is deliberately unchanged; the CI number to compare is the
85.78px report, which becomes the ~2.7px Arial-equivalent calibration.)

Wordmark box across the swap:

- before the pin, forcing a narrow serif shrank the logo: wordmark 200 → 192.8px,
  logo 268 → 260.8px (a ~7px common shift for every navigation item);
- after the pin: wordmark **200 → 200px**, logo **268 → 268px**, with the same
  narrow serif forced in.

Calibration re-checked with `node tools/diagnose-navigation-lock.mjs --tune`
(unchanged table: Segoe UI 109.75% → 1.44px, Tahoma 110.75% → 1.66px, Verdana
97% → 2.31px, Arial 107% → 2.70px).

## Verification

| Check | Result |
| --- | --- |
| Navigation hit targets (1440/1280 light+dark, 1024 drawer, the nine-point click, the 100-click stress) | **5 passed** |
| Calibrated fallback resolved here | `Open Sans Fallback Arial` |
| Header collision probe | 550 checks, 0 problems |
| Full Playwright suite | **325 passed, 209 skipped, 0 failed** (6.0 min) |
| Visual regression | all baselines matched (the fix is invisible where the fonts resolve) |
| axe (day/night × desktop/mobile, inside the suite) | 0 violations |
| Thresholds | `MATERIAL_MOVEMENT_PX` still 3, font-swap test unchanged, `font-display: swap` retained, no CDN, no font files added to the repository |

## Round 2: the runner's local-face rendering is not metric-stable

The CI run for `0217dad` (`Deploy static content to Pages`, run 35002726485)
still failed the guard, at light / 1440px:

```
Home -14, About Us -13, Membership -11, Fixtures -7, News -5,
Gallery -7, Contact Us -6, Sponsors -5, Honours -4   (budget: < 3px)
```

### What those numbers say

The row is right-aligned and every box that could move it has a
font-independent size (`body > header .container`, `.logo` — pinned to
`width: 10em` at this width — the 44px theme toggle and the container padding).
Measured locally across the whole swap, every one of those boxes stayed at
Δleft 0.00 / Δwidth 0.00 while the `ul` only changed width, so consecutive
movements give the individual label width differences — which is what a
`size-adjust` has to be derived from:

| Label | CI movement | Δ width | runner fallback ÷ Open Sans |
| --- | --- | --- | --- |
| Home | -14 | -1.0 | 98.23% |
| About Us | -13 | -2.0 | 97.43% |
| Membership | -11 | -4.0 | 96.06% |
| Fixtures | -7 | -2.0 | 97.16% |
| News & Events | -5 | +2.0 | 101.73% |
| Gallery | -7 | -1.0 | 98.43% |
| Contact Us | -6 | -1.0 | 98.88% |
| Sponsors | -5 | -1.0 | 98.72% |
| Honours | -4 | (anchor) | — |

### The derived Linux calibration

Against the locally measured 107% face, those ratios are a least-squares scale
of **0.9832** — the runner renders the local face about 1.7% narrower than this
machine does — so the size-adjust that would neutralise it is
`107 / 0.9832` = **108.8%** (per-label RMSE 1.36px, worst residual 2.31px; a
free constant instead gives 0.9880 with a -2.5px common shift, RMSE 0.64px).
`'Open Sans Fallback Liberation'` now ships **108.8%**, derived from the runner's
own numbers rather than copied from Arial. (`tools/diagnose-navigation-lock.mjs
--tune --font-file=… --font-name="Liberation Sans"` still measures 107% as the
optimum here, which is exactly the discrepancy: the *font* is metric-compatible
with Arial, the runner's *rendering* is not.)

### Why a calibration alone was never going to be enough

The individual corrections implied above range from **-1.7% (News & Events) to
+4.1% (Membership)**, and the residual spread is ±2.3px per label. A single
global `size-adjust` cannot satisfy them all, and whatever it leaves behind
accumulates across a right-aligned row. The same is true of any other system
font: the platform's rasterisation of a *local* face (hinting, grid fitting,
synthetic bold) is not a portable, measurable quantity from here.

### The fix: the navigation paints with the face it settles in

`'Open Sans Nav'` is a subset of the **same** Open Sans instance the navigation
ends up in — generated from the labels in `_includes/header.njk` by
`tools/fetch-vendor-assets.mjs` (Google's `text=` subsetting, the same pipeline
that already self-hosts the site's fonts) and inlined into
`vendor/fonts/fonts.css` as a `data:` URI. Being inline there is no fetch to
race, so it is in effect at first layout (measured: identical widths at
`DOMContentLoaded`) and the row cannot move on any platform, whatever local
fonts the machine has. `body > header nav ul li a` now uses
`'Open Sans', 'Open Sans Nav', var(--font-ui)`.

Kept as they were: self-hosted Open Sans, `font-display: swap`, both preloads,
the four calibrated local faces (now the second tier for the rest of
`--font-ui`), the accepted navigation design, and the 3px threshold. Nothing is
disabled and no CDN is involved.

Cost: `vendor/fonts/fonts.css` grows from 2,923 to 11,683 bytes (a 6,124-byte
subset, 8,165 base64 characters) and the explanatory comments in `styles.css`
add ~1.2KB. The refreshed page-weight measurement for the home page is
1,291,171 bytes, +9.9KB. That is the price of removing the platform-font
dependency; nothing in the suite asserts a weight budget.

### Measurements after the fix (this machine)

| Viewport | Theme | Worst movement before | Worst movement after |
| --- | --- | --- | --- |
| 1440px | light | 2.70px | **0.00px** |
| 1440px | dark | 2.70px | **0.00px** |
| 1280px | light | 2.70px | **0.00px** |
| 1280px | dark | 2.70px | **0.00px** |
| 1024px | light (drawer) | 0.00px | **0.00px** |
| 1024px | dark (drawer) | 0.00px | **0.00px** |

Per label at 1440px light: every one of the nine labels measured a 100.00%
fallback→webfont width ratio (Home 56.5 → 56.5, About Us 77.8 → 77.8,
Membership 101.48 → 101.48, Fixtures 70.44 → 70.44, News & Events 115.5 → 115.5,
Gallery 63.69 → 63.69, Contact Us 89.31 → 89.31, Sponsors 78.08 → 78.08,
Honours 74.27 → 74.27) — including `Fixtures`, which is the `font-weight: 700`
active label on that page. The header boxes stayed at Δleft 0.00 / Δwidth 0.00.

`tests/navigation-hit-target.spec.js` now also asserts the mechanism, so it
fails on *every* platform (not only Linux) if the subset is dropped, un-inlined,
reordered behind the platform faces, or stops covering a character of a label;
the movement test prints the header-box deltas when it fails, so any future
common shift is attributed instead of being blamed on the labels.

## Verification (round 2)

| Check | Result |
| --- | --- |
| Navigation guard (`tests/navigation-hit-target.spec.js`, desktop) | **6 passed** (`MATERIAL_MOVEMENT_PX` still 3) |
| Full Playwright suite | **326 passed, 211 skipped, 0 failed** (5.6 min) |
| Visual regression | every baseline matched (the settled paint is unchanged) |
| Header collision probe (`tools/audit-header-layout.mjs`) | 550 checks, 0 problems |
| axe, internal links, image references | inside the suite: 0 violations, 0 broken links, 0 broken references |
| `--font-file` tuning of the real Liberation Sans | optimum 107.00% / 2.70px (unchanged), which is why the Linux face's 108.8% is documented as runner-derived |

## What could not be measured from here

This machine has no Linux runtime (no WSL, no Docker daemon), so the runner's
own rendering cannot be reproduced locally and the CI logs need an authenticated
session. That is why the fix does not depend on reproducing it: the navigation
no longer uses a platform font at all. The guard still prints, on every run,
which calibrated family resolved (`[nav-guard] calibrated fallback in effect:
·`) together with the per-label widths and ratios — useful for the rest of
`--font-ui`, and the first thing to read if a future run fails for another
reason.

## Should CI pass now?

Yes, and for a stronger reason than round 1: the guarded surface no longer
depends on which fonts Ubuntu ships or how it rasterises them. The remaining
Linux-specific quantity (the local face's 108.8% calibration) only affects live
text outside the navigation, where a few pixels of re-flow is not a usability
bug.
