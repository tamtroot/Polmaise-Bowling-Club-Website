# CI fix — cross-platform visual baselines

Scope: the last Stage 16 CI failure, where `tests/visual-regression.spec.js`
reported e.g. *"Home desktop baseline: 22256 pixels differ, ratio 0.02"* on the
Ubuntu runner. No tolerance was changed, no visual test was skipped or disabled,
and no website layout was touched.

## Root cause

The baselines were captured on Windows and the deployment gate runs on
`ubuntu-latest`. Chromium rasterises text with the platform's own stack —
DirectWrite/ClearType on Windows, FreeType/fontconfig on Linux — so the same DOM
produces the same *layout* but different *pixels*. Comparing them fails on
rasterisation alone; enlarging `toHaveScreenshot`'s tolerance would have hidden
real regressions, and skipping the visual suite on Linux would have removed the
gate entirely.

## Strategy: one accepted set per platform, resolved by Playwright

`playwright.config.js` keeps its single template and adds Playwright's
`{platform}` token (`process.platform`):

```
tests/__screenshots__/visual-regression.spec.js/<page>-<viewport>-<platform>.png
```

| Platform | Files | Role |
| --- | --- | --- |
| Linux | `…-<viewport>-linux.png` | **Authoritative for the deployment gate** (the workflow runs `ubuntu-latest`) |
| Windows | `…-<viewport>-win32.png` | Retained for local Windows development |

No per-platform branches in the tests, no duplicated "unnecessary" sets: each
platform resolves exactly the set it captured, and a platform without a set fails
loudly (verified: a missing baseline fails the test and writes only the *actual*
to `test-results/`, so it can never pass silently).

The 100 existing Windows baselines were renamed `<page>-<viewport>.png` →
`<page>-<viewport>-win32.png`. The rename was verified byte-for-byte: every file
hash matches its committed blob (100 checked, 0 content changes).

## Generating the Linux set (reviewed, not automatic)

`.github/workflows/visual-baselines.yml` is a new **manual** workflow
(`workflow_dispatch` only) that mirrors the deployment workflow's environment
exactly — `ubuntu-latest`, Node 22 with npm cache, `npm ci`,
`npx playwright install --with-deps chromium`, `npm run build` — and then:

1. runs **only** the visual suite in update mode
   (`npx playwright test tests/visual-regression.spec.js --update-snapshots`),
   which writes `tests/__screenshots__/**-linux.png`;
2. compares the new Linux PNGs with the committed Windows set
   (`node tools/compare-visual-baselines.mjs --platform=linux --against=win32`)
   and prints/records size, differing pixels, changed region, mean/max channel
   delta, the best small offset and how much of the difference it removes;
3. uploads the PNGs **and** `reports/latest/visual-baseline-review.json` as the
   `linux-visual-baselines` artifact — `if: always()`, and `if-no-files-found:
   error`, so an empty run cannot look like success;
4. re-runs the visual suite without the update flag to prove the generated set
   passes the ordinary gate.

It has `permissions: contents: read`, contains no deploy step and no `git`
command at all: it cannot commit, push or publish anything. Committing the
artifact is a separate, human-reviewed step.

## What the baseline review will show

This machine has no Linux runtime (no WSL, no Docker daemon) and pushing is
outside what I can do unattended, so the Linux set itself has to be produced by
the workflow above — that is the review step the task asks for. What can be said
sandwiched between Windows measurements and the Linux evidence already in CI:

- **Count**: 100 baselines, exactly the same names/projects as the Windows set —
  25 pages × desktop day, desktop night, tablet and mobile (50 desktop + 25
  tablet + 25 mobile).
- **Which differ**: every screen carries text (the wordmark, the navigation and
  the page copy), so every pair is expected to differ in some pixels; the
  reported CI figure for the home page was 22,256 px (ratio 0.02). The artifact's
  `visual-baseline-review.json` gives the per-page numbers.
- **Rasterisation or geometry**: the workflow's comparison classifies each pair.
  It looks for a small whole-image offset (the signature of a layout difference)
  and only calls a pair `shift`/`size`/`review` when it needs a human look;
  rasterisation of the same geometry never aligns away and is reported as
  `rasterisation`. Corroborating evidence that the Linux geometry is the same as
  Windows': the CI run for `ed64d7b` (the font-swap fix) passes every functional
  gate on the Linux runner — the navigation guard across the font swap, the
  header collision probe, page audits, fixtures UX — and fails *only* on these
  snapshots. A 0.02 ratio scattered over the page is also the signature of
  anti-aliasing over text; a moved element shows up as aligned edges.

## Files to commit

| File(s) | Why |
| --- | --- |
| `playwright.config.js` | `{platform}` in `snapshotPathTemplate` + rationale |
| `tests/__screenshots__/visual-regression.spec.js/*.png` | the 100 existing baselines renamed to `…-win32.png` (content unchanged) |
| `tests/__screenshots__/visual-regression.spec.js/*-linux.png` | the reviewed artifact from the workflow — **100 new files** |
| `.github/workflows/visual-baselines.yml` | the manual generator (no deploy, read-only token) |
| `tools/compare-visual-baselines.mjs` | cross-platform review comparison |
| `tools/analyse-visual-diff.mjs` | failure-diff tool updated for the platform suffix |
| `MAINTENANCE.md`, `README.md`, `ARCHITECTURE.md`, `RELEASE.md` | platform-specific baselines, authority, regeneration and review |

## Verification on the machine that has the Windows set

| Check | Result |
| --- | --- |
| Visual suite with the platform token (Windows) | **100 passed, 50 skipped** (night baselines are desktop-only) |
| Baseline rename | 100 files, all byte-identical to their committed counterparts |
| Missing baseline behaviour | test fails, no baseline written (cannot pass silently) |
| `tools/analyse-visual-diff.mjs` on a real failure artifact | resolves `…-win32.png` and reports 0 differing pixels for a restored baseline |
| `tools/compare-visual-baselines.mjs` | 100/100 pairs `identical` when a platform is compared with itself; synthetic `shift`, `size`, `missing` and `rasterisation` cases classify correctly |
| Workflow YAML | parses; single `workflow_dispatch` trigger; `permissions: contents: read`; one job, no deploy step |
| Full Playwright suite (Windows) | **326 passed, 211 skipped, 0 failed** (5.9 min) — identical to the pre-change result, so the functional suite is unaffected |

## What CI does after the Linux set is committed

`static.yml` is unchanged: it still runs `npm test` (no update flag, no write
permission) and the visual suite now compares Linux-against-Linux, so the gate
passes with the *same* tolerance (`threshold: 0.2`, `maxDiffPixelRatio: 0.002`,
`animations: "disabled"`) and the same assertions. Nothing about the gate was
weakened: the diff tolerance, the masks, the viewports, the clock freeze and the
night-theme coverage are all untouched.

Until the Linux set is generated and committed, the deployment run will report
the same visual failure (now as "a snapshot does not exist" for
`…-linux.png`). That window is inherent to reviewing baselines before they become
the gate's truth, which is what this change is for.

The CI log for the passing run cannot be produced from here — this machine has
no Linux runtime, and triggering the workflow needs your GitHub session — so the
equivalent verification is the workflow's last step ("Confirm the generated set
passes the normal gate"), which runs the same visual suite with no update flag
against the freshly written baselines. Once the reviewed PNGs are committed, the
deployment run does exactly that comparison and, on the evidence above
(rasterisation-only differences, every functional gate already green on Linux),
`npm test` goes through: 100 visual comparisons pass, 50 night/other-project
combinations skip, and the rest of the suite is unchanged.
