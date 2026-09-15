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

## Should CI pass now?

Yes: the Linux navigation now paints with a calibrated `Liberation Sans` face
that the workflow's own dependency install guarantees, and the logo can no
longer move the menu when the serif fallback differs. The one thing that cannot
be proven from Windows is which system font the runner would have used — the new
guard prints the calibrated family it resolved, so the first CI run will confirm
it in the log.
