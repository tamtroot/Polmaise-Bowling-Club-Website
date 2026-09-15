# Stage 12 — final content/design refinement pass

Closing pass on the accepted homepage. No architecture and no shared theme
change: `styles.css`, `script.js`, the token layer, the 1280px navigation
breakpoint, the font-swap fix and the image pipeline are untouched
(`tools/image-pipeline.mjs` was instrumented during diagnosis and returned to
its committed state — `git diff` is empty for it).

## 1. Hero copy

`_data/homepageContent.json` → `hero.intro` replaced:

```
before  A friendly lawn bowls club on the green at Fallin, welcoming bowlers of
        all ages and skill levels since 1911.
after   At the heart of Fallin since 1911. A friendly local club with a proud
        history, competitive bowls and a strong community spirit.
```

The title and "Tradition, Community, Excellence" are unchanged. The new sentence
stays within published facts (established 1911, Fallin, the club's own history
and competition pages) and drops the age-range/inclusivity claim. A test now
pins the exact wording.

## 2. Hero photograph

The hero now uses the replacement `Images/Archive/Photo 25.jpg` supplied with
this stage (1,275 × 941, golden-hour trophy on the green with the clubhouse
behind) — still referenced through `homepage.hero.image.src`, so the caption and
the social card follow automatically.

Two consequences were handled:

1. `Images/Archive/Photo 25-thumb.jpg` had been deleted with the old photograph.
   The legacy archive album on `gallery.html` enumerates
   `Images/Archive/Photo N-thumb.jpg` for N = 2…191, so the build failed with
   `Failed to build Images/Archive/Photo 25-thumb.jpg at 400px`. The thumbnail
   was regenerated from the new photograph at the same convention as its
   siblings (300 px wide JPEG, 16.5 KB) — the gallery page is unchanged.
2. `reports/stage6/source-image-manifest.json` was regenerated
   (`node tools/write-image-manifest.mjs`, now 1,913 sources) so the archive
   checks match the new files.

Note for a future pass: the new original is 1,275 px wide, so retina displays see
an upscale of the 1,600 px candidate. A larger original would sharpen the hero
on high-DPI screens.

## 3. Feature card design consistency

Audited the Next Fixture / Latest Result / Live Scores cards — no structural
change, two literals replaced with design-system values:

| Declaration | Before | After |
| --- | --- | --- |
| `.home-feature-value` font size | `1.0625rem` | `var(--step-card)` (shared card-title step) |
| `.home-feature-link i` font size | `0.75rem` | `var(--step-label)` |

Everything else in the cards already used tokens: `--font-display` for the value,
`--step-label`/`--tracking-label` + `--color-text-muted` for the label,
`--color-accent` for the icon, `--step-small` + `--color-text-muted` for the
body, and `--color-surface`/`--color-border`/`--radius-md`/`--shadow-xs` for the
card. No homepage-specific colour or font literal remains in the feature strip.

## 4. News data

No automation added. `_data/homepageContent.json` gained a `_newsCuration` note
stating that the three homepage stories are a hand-maintained curated selection,
that Stage 12 deliberately avoids any weekly/AI editorial dependency, and that
**Stage 13 will introduce an Eleventy news collection** so the homepage can
render the newest published stories automatically. `MAINTENANCE.md` records the
same handover.

## 5. Gallery cover images

Automatic selection of the six newest albums is retained. Each album in
`_data/gallery.json` may now nominate:

```json
"coverImage": { "src": "./Images/…/photo.jpg", "alt": "…" }
```

`_data/homepage.js` uses `coverImage` when present and otherwise falls back to
the existing rule (first full-size original, then first `-thumb`). Nominated
covers for the six currently displayed albums:

| Album | Cover | Why |
| --- | --- | --- |
| Finals Day 2026 | `2026/Finals Day/Finalists.jpg` | Finalists line-up on the green |
| Opening of Green 2026 | `2026/Opening of Green 2026/Opening of Green.jpg` | Mrs Stewart throwing the first bowl |
| Top 15 Final 10/08/2025 | `2025/Top15Final/20250810_134840-thumb.jpg` | Team line-up |
| John, Mark & Iain Bone – A Family of Bowlers | `JockBone/FB_IMG_1753006294768-thumb.jpg` | **Changed**: a team photograph instead of the club-badges display that the first-image rule picked |
| Polmaise Ladies Top 5 | `2025/PolmaiseLadiesTop5/20250626_190850-thumb.jpg` | Bowler in action |
| Murray Cup 2025 | `2025/MurrayCup/MurrayCupA-thumb.jpeg` | Bowler in action |

A benefit beyond the visual improvement: appending a new photograph to an album
no longer silently changes its homepage cover. All paths stay inside the gallery
dataset — nothing is hard-coded on the homepage — and a test asserts the curated
Bone cover is the one rendered.

## 6. New to bowls photograph

The section is unchanged and still shows the crest-gate photograph. It is now
explicitly flagged as temporary, both in `index.html` (a template comment) and
in `MAINTENANCE.md`: the section is designed around a photograph of people
trying or being coached at bowls, and no replacement was fabricated.

## 7. Sponsor presentation

Logos are unchanged; only their presentation was normalised:

| Property | Before | After |
| --- | --- | --- |
| Card height | fixed `6rem` | `aspect-ratio: 3 / 2` (equal card dimensions) |
| Padding | `var(--space-4)` | `clamp(1rem, 1.6vw, 1.5rem)` (optical padding) |
| Logo box | `max-height: 3rem; width/height: auto` | `width/height: 100%` inside the padded area |
| Fit | `object-fit: contain` | unchanged |

Every logo is now given the same display area and is contained inside it, so a
tall logo and a wide logo read with comparable presence. The section was made
slightly more prominent using the existing palette: it sits on the tinted
`--color-surface-alt` band (the membership call to action moved to the page
background so the two do not merge), and a factual supporting line —
"Proudly supported by local businesses" — now sits under the heading. Tests
assert all six tiles are identical in size, that the images use
`object-fit: contain`, and that the supporting line is present.

## 8. Verification after the pass

| Gate | Result |
| --- | --- |
| Homepage suites (`tests/homepage.spec.js`, `tests/homepage-fixtures.spec.js`) | pass (homepage tests now also pin the hero wording, the curated cover and the sponsor tile geometry) |
| Full Playwright suite | **209 passed**, 4 failures — all four were the homepage visual baselines, regenerated after review |
| Visual regression (after re-baselining) | **72 passed** — every non-homepage baseline unchanged, confirming no other page shifted |
| axe (day/night × desktop/mobile, 18 pages) | **0 violations** |
| Header collision probe | **396 checks, 0 problems** |
| Responsive overflow (375/768/1024/1280/1440 × both themes) | 0 overflow, asserted in `tests/homepage.spec.js` |
| Day/night captures | reviewed at desktop, tablet and mobile; no white islands, no broken images, no console errors on the homepage |

Baselines: the previous homepage baselines are archived in
`reports/baseline/visual/stage12-initial/`; the four refined baselines are the
current ones.

## 9. Homepage weight

| Metric | Before Stage 12 | Initial Stage 12 | After this pass |
| --- | --- | --- | --- |
| Requests | 14 | 23 | 23 |
| Transfer (uncompressed) | 926 KiB | 1,324 KiB | **1,303 KiB** |
| Document | 12 KiB | 48 KiB | 49 KiB (≈8 KiB gzipped) |
| Images | 4 / 323 KiB | 13 / 685 KiB | 13 / 664 KiB |
| CSS / JS / fonts | 148 / 9 / 434 KiB | unchanged | unchanged |

The hero derivative fell from 165 KiB to 146 KiB because the replacement
original is smaller. `styles.css` and `script.js` remain byte-identical to
Stage 11; no new external origins.
