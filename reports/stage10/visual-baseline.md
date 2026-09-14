# Stage 10 visual baseline

Stage 10 is a **targeted correction** of the Stage 9 baseline: the theme
architecture, tokens and accessibility work are unchanged, while the header,
navigation states, hero buttons and footer were restored/refined.

## What is where

| Artefact | Location | Notes |
| --- | --- | --- |
| Stage 10 baseline (current) | `tests/__screenshots__/visual-regression.spec.js/` | 72 images: 18 pages × desktop/tablet/mobile day, plus 18 desktop night images |
| Stage 9 baseline (archived) | `reports/baseline/visual/stage9/` | 72 images, the token/dual-theme release |
| Stage 8 baseline (archived) | `reports/baseline/visual/stage8/` | 54 images, pre-theme release |
| Stage 10 review captures | `reports/stage9/visual-review.json` | 92 day/night captures with the automated findings (the capture tool is shared between stages 9 and 10) |
| Difference analysis | `tools/analyse-visual-diff.mjs` | Run after a failing visual test to quantify and locate the changes |

## Reproducing

```powershell
$env:SITE_ROOT="_site-alt"; $env:IMAGE_CACHE_ROOT=".cache-alt\images"
npm.cmd run build
npx.cmd playwright test tests/visual-regression.spec.js
```

To record deliberate changes:

```powershell
npx.cmd playwright test tests/visual-regression.spec.js --update-snapshots
node tools/analyse-visual-diff.mjs    # quantify against the previous baseline first
```

## Intentional differences from Stage 9

1. Header: transparent crest (no white square), two-line Playfair Display
   wordmark with a brass rule, active navigation shown by an accent underline
   and text colour rather than a filled block.
2. Hero: solid primary and secondary call-to-action buttons.
3. Footer: royal navy in the day theme, darker navy at night, brass headings,
   translucent white social buttons with visible white glyphs.
4. Inner sections: tighter heading leading, 62ch intro measure, hairline
   separators, softer card hover shadows, 44px minimum control height.

Anything outside those areas appearing in a future diff is a regression, not a
baseline change.
