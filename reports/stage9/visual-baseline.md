# Stage 9 visual baseline

Stage 9 is the intentional visual reset point for this site. The day/night
theme work changes appearance on every page by design, so the Stage 8 visual
baseline was archived and a new Stage 9 baseline was recorded.

## What is where

| Artefact | Location | Notes |
| --- | --- | --- |
| Stage 9 baseline (current) | `tests/__screenshots__/visual-regression.spec.js/` | 72 images: 18 pages × desktop/tablet/mobile in the day theme (`<page>-<viewport>.png`), plus 18 desktop night-theme images (`<page>-night-desktop.png`) |
| Stage 8 baseline (archived) | `reports/baseline/visual/stage8/` | The 54 pre-Stage-9 images, exactly as committed at `b1725ff` (Stage 8: release hardening and technical handover) |
| Stage 9 review captures | `reports/stage9/visual-review.json` | 92 captures (day + night) with the automated findings; the PNGs themselves live outside the repo, see below |

## Reproducing

```powershell
$env:SITE_ROOT="_site-alt"; $env:IMAGE_CACHE_ROOT=".cache-alt\images"
npm.cmd run build
npx.cmd playwright test tests/visual-regression.spec.js
```

To regenerate deliberate visual changes:

```powershell
npx.cmd playwright test tests/visual-regression.spec.js --update-snapshots
```

To re-run the wider review (screenshots + white-island/legacy-hue/overflow
checks), which writes PNGs outside the working copy so the repository stays
small:

```powershell
$env:SITE_ROOT="_site-alt"
node tools/capture-stage9-visuals.mjs   # output: %TEMP%\polmaise-stage9-visuals
```

## Restoring the Stage 8 images

The Stage 8 baseline is preserved twice: in this archive folder and in git
history at `b1725ff`, for example:

```powershell
git show b1725ff:tests/__screenshots__/visual-regression.spec.js/home-desktop.png > home-desktop.png
```

## Known differences that the new baseline encodes

- The shared header now carries a day/night toggle, and the inline desktop
  navigation moves to the burger menu below 1280px so the toggle and the club
  wordmark never collide.
- Page-local legacy surfaces (cards, panels, badges, boards) render from shared
  semantic tokens in both themes.
- The news article `News articles/presentation-dance-2025.html` no longer uses
  its own navy/gold/green event palette; it uses the shared system, with the
  poster photograph and dark scrim hero unchanged.
