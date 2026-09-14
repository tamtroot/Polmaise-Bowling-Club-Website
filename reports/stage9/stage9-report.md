# Stage 9 — dual-theme design system

Continuation of the interrupted Stage 9 session: the existing token work, theme
test and header control were kept, the night-theme contrast blocker was cleared
by migrating page-level colours onto the shared tokens, and both themes now pass
the accessibility gate. Stage 9 is the intentional visual reset point.

## 1. Final palettes

Day theme (default, works without JavaScript):

| Token | Value | Role |
| --- | --- | --- |
| `--color-bg` | `#FFFFFF` | page background |
| `--color-surface` | `#F4F7FC` | cards and panels |
| `--color-surface-alt` | `#E8EFF9` | alternate surfaces (footer, stripes, strips) |
| `--color-text` | `#14203A` | body text |
| `--color-text-muted` | `#4A566E` | secondary text |
| `--color-primary` | `#16307A` | club navy: brand fills, links, headings |
| `--color-accent` | `#1F6FB2` | sky-blue accent, icons, rules |
| `--color-accent-soft` | `#D6E6F7` | highlighted surfaces (next fixture, notices) |
| `--color-border` | `#D3DDEB` | borders and dividers |
| `--color-focus` | `#0B5FFF` | focus ring |
| `--color-on-primary` | `#FFFFFF` | text on a primary fill |
| `--color-on-inverse` | `#FFFFFF` | text over photography/scrims |

Night theme (`[data-theme="dark"]`):

| Token | Value | Role |
| --- | --- | --- |
| `--color-bg` | `#0E1116` | page background |
| `--color-surface` | `#171C23` | cards and panels |
| `--color-surface-alt` | `#1F2630` | alternate surfaces |
| `--color-text` | `#F2F5F9` | body text |
| `--color-text-muted` | `#A9B4C4` | secondary text |
| `--color-primary` | `#9FC3F0` | light blue brand fill with dark text |
| `--color-accent` | `#63B3F5` | electric blue accent |
| `--color-accent-soft` | `#20303F` | highlighted surfaces |
| `--color-border` | `#2A323D` | borders and dividers |
| `--color-focus` | `#7CC4FF` | focus ring |
| `--color-on-primary` | `#0E1116` | text on a light-blue fill |
| `--color-on-inverse` | `#FFFFFF` | text over photography/scrims |

## 2. Semantic token architecture

One component system, two themes. `styles.css` keeps a single `:root` block
(typography, spacing, shape, motion, day colours) and a single
`[data-theme="dark"]` block that re-points the colour tokens. Component rules
only ever reference tokens, so no component needs its own dark-theme copy.

Colour tokens added in this session (beyond the original set):

| Token group | Day | Night | Used for |
| --- | --- | --- | --- |
| `--color-on-inverse` | `#FFFFFF` | `#FFFFFF` | hero/banner/lightbox text over photos and scrims |
| `--color-positive-surface` / `-text` | `#E4F4E9` / `#16653A` | `#16301F` / `#86DCA6` | Confirmed badges, "future vision" panel |
| `--color-warning-surface` / `-text` | `#FDF1DC` / `#8A4B08` | `#33260F` / `#F2C879` | Proposed badges, "fun fact" panel |
| `--color-neutral-surface` / `-text` | `#EEF0F3` / `#4A566E` | `#232A34` / `#A9B4C4` | TBC badges |
| `--color-notice-surface` / `-border` | `#FFF8E6` / `#E6A800` | `#2A2412` / `#F0C24B` | payment/membership notice panel |
| `--color-heritage-*` (`surface`, `surface-alt`, `border`, `inner`, `text`, `highlight`) | warm cream/oak | dark walnut/brass | framed honours boards |
| `--color-row-stripe` / `--color-row-hover` | navy 6% / 12% | blue 8% / 16% | table striping, list and accordion hover |

Legacy palette variables (`--club-blue`, `--white`, `--light-gray`,
`--light-blue`, `--dark-gray`, `--dark-blue`, `--surface-subtle`, `--navy`)
are now only defined for backwards compatibility; every component rule that
used them has been rewritten to a semantic token.

The theme is applied before first paint by a small inline script in
`_includes/head.njk` reading `localStorage["polmaise-theme"]`, and kept in sync
by the header toggle (`_includes/header.njk` + `script.js`).

## 3. Page-level styles migrated

Worked page-by-page rather than with a dark-theme override sheet:

| Page | Migrated |
| --- | --- |
| `index.html` | hero scrim left as a photo overlay; link cards now inherit shared card surfaces |
| `about.html` | committee members, article viewer, timeline hover, history CTA, lightbox caption |
| `membership.html`, `signup.html` | benefit cards, steps, fee table stripes, payment notice, help options, form surfaces |
| `fixtures.html` | table striping/hover, past and next fixture rows, fixture cards, status badges (Confirmed/TBC/Proposed), download box |
| `news.html` | news cards, card dates, archive headers, article panels, history blocks, zoomable images, update notes |
| `gallery.html` | album cards, gallery items, captions, close button |
| `contact.html` | contact panel, direction items, cookie banner, privacy modal, accordion |
| `sponsors.html` | main sponsor cards, sponsor logos, business cards, card headers |
| `honours.html` | achievement cards, year headers, heritage president/champion boards |
| `archive.html` | archive intro, categories, archive items, captions |
| `history.html` | intro, timeline markers, highlight/fun-fact/future-vision panels, source categories |
| `live-scoring.html` | frame wrapper, fallback text, expanded scoreboard |
| `News articles/presentation-dance-2025.html` | retired navy/gold/green event palette replaced by the shared tokens; hero photograph and scrim retained |
| `PhotoAlbums/*.html` (4 pages) | album intro, result/tournament panels, figures |

Counters from `tools/audit-page-colours.mjs`:

- page-level colour declarations: **254 → 53** (73 → 18 distinct literal values)
- the 53 remaining are photographic overlays and neutral black/white alpha
  shadows (`rgba(0,0,0,0.1)`, `rgba(0,0,0,0.7)`, lightbox scrims), which read
  correctly in both themes and stay theme-agnostic.

The temporary 14-selector dark override layer from the previous session was
deleted; only the page-banner/watermark rule remains because a photo banner is
genuinely theme-specific.

## 4. Contrast / axe

`tools/audit-accessibility.mjs` now reports four passes per page (day and night
× desktop 1440 and mobile 390).

| Pass | Before this session | After |
| --- | --- | --- |
| Day desktop | 16 (all on the Presentation Dance article page) | 0 |
| Day mobile | not measured | 0 |
| Night desktop | 305 colour-contrast instances | 0 |
| Night mobile | 585 colour-contrast instances | 0 |

Worst pre-fix examples: `membership.html` 29, `sponsors.html` 34,
`history.html` 81, `fixtures.html` 287 at mobile, with foreground/background
pairs as low as 1.09:1. The one day-theme failure set (16 instances on
`News articles/presentation-dance-2025.html` — gold headings on white and a
dark footer with navy headings) is also resolved.

## 5. Inline styles

| Measurement | Before | After |
| --- | --- | --- |
| Template `style="…"` attributes (`tools/audit-inline-styles.mjs`) | 55 across 5 files (48 in `news.html`) | 0 |
| Inline styles in rendered HTML (built pages) | not recorded before the migration | 2 |

The two retained inline styles are per-image focal points passed to the
`{% photoImage %}` shortcode (`object-position: center 38%` and `center 35%`) —
genuinely data-driven values, not presentation constants.

Presentation-only inline styles became named classes (`news-figure`,
`news-figcaption`, `plain-list*`, `history-feature-row`, `looking-back-*`,
`figure-reset`, `history-float-figure`, `history-thumb-stack`,
`committee-members--spaced`, `cta-heading`, `cta-button-label`,
`closing-quote`, `news-cta`). JS-driven `style.display` toggles became the
shared `.is-hidden` / `.is-visible` classes, and `script.js`/page scripts were
updated accordingly.

## 6. Theme tests

`tests/theme.spec.js` — **18/18 passing** (6 tests × desktop/tablet/mobile):
day is the default; switching to night and back updates `data-theme`,
`aria-pressed` and the accessible name; the choice survives reload and
navigation; an explicit stored day preference beats a dark OS preference; the
toggle is keyboard operable (Enter and Space) with a visible focus ring; the
night theme produces no console errors and keeps the fixture table/mobile cards
visible.

One pre-existing test defect was corrected: the fixtures visibility assertion
was viewport-dependent and ran on the mobile/tablet projects, so it now pins
the viewport explicitly.

## 7. Full regression

`npx playwright test` — **174 passed, 0 failed, 90 skipped** (desktop-only
suites skipped on tablet/mobile), covering build output and Stage 2A structure,
HTML validation, image references, internal links, JavaScript interactions,
keyboard accessibility, page audits (console/page errors, failed requests,
axe), SEO metadata and sitemap, theme behaviour and the visual baselines.

- zero new page errors, zero console errors (except the known third-party Live
  Scoring service 401, which is accepted and unchanged)
- zero broken image references (2,025 references verified)
- zero broken internal links
- SEO tests pass
- `tools/audit-header-layout.mjs`: 396 header checks (18 pages × 11 widths × 2
  themes) → **0 problems**

## 8. Both-theme visual review

92 captures (18 pages × 3 viewports in day; night at all viewports for ten
pages and desktop elsewhere) plus automated findings in
`reports/stage9/visual-review.json`:

| Check | Result |
| --- | --- |
| Dark-mode "white islands" (light opaque backgrounds ≥ 3000px²) | 0 |
| Horizontal overflow | 0 |
| Broken images | 0 |
| Console errors | 4 — all the accepted Live Scoring 401 |
| Page errors | 0 |
| Hidden form controls | 52, all contextually hidden by design (mobile menu at desktop, album close buttons with no album open, membership number field before the checkbox, scoreboard exit) |
| Retired gold/green fragments | none from the old brand palette; the only warm/green values left are the intentional status tokens (Confirmed/Proposed/TBC badges, reminder and "future vision" panels) and the walnut/brass heritage boards |

Manual review of the day set (all 54) and the night set (home, fixtures, news,
gallery, history, membership, signup, sponsors, archive, a PhotoAlbum, the
Presentation Dance article) found no unreadable text, content loss, broken
controls or mobile spacing problems.

One genuine defect was found and fixed during this review: the Stage 9 header
restyle made the club wordmark collide with the desktop navigation, because the
new theme toggle no longer fitted beside a nine-item inline nav. The nav link
metrics were tightened and the inline navigation now hands over to the burger
menu below 1280px (previously 992px), which the header probe verifies at every
breakpoint boundary in both themes.

## 9. Stage 9 baseline

- Stage 8 baseline archived: `reports/baseline/visual/stage8/` (54 images, also
  recoverable from git `b1725ff`).
- Stage 9 baseline created: 54 day images (18 pages × desktop/tablet/mobile) and
  18 desktop night images, in `tests/__screenshots__/visual-regression.spec.js/`.
- `tests/visual-regression.spec.js` gained the night-theme test; the suite
  passes on a clean run.
- Documented in `reports/stage9/visual-baseline.md`.

## 10. Size and performance

| Asset | Stage 8 (HEAD) | Stage 9 | Change |
| --- | --- | --- | --- |
| `styles.css` | 28,762 B | 41,782 B | +13,020 B (+45%) |
| `script.js` | 6,825 B | 8,189 B | +1,364 B (+20%) |
| Homepage, total transferred | 376,041 B | 391,247 B | +15,206 B (+4.0%) |
| Homepage resources | 7 | 7 | no new requests |

- No new font files, no new images, no new network requests. The pre-paint
  theme initialiser is inline in `head.njk` (~330 B per page, no request).
- Theme cost is one attribute read plus one `localStorage` read per page load;
  the toggle writes `localStorage` only on click. Switching themes is a single
  attribute change on `<html>` — no re-render, no request.
- The +13 KB of CSS is the shared token system plus the page-level migration
  (and the removal of the ad-hoc override layer); it replaces hard-coded
  colours rather than adding a second stylesheet.

## 11. Remaining visual debt

1. The framed honours boards use a warm walnut/brass palette in the night theme
   (`--color-heritage-*`). It is intentional — a physical plaque metaphor with
   11.5:1 contrast — but it is the one surface that leaves the black/blue
   identity. If the club prefers strict blue in night mode, only those six
   tokens need changing.
2. Status badges (green/amber) are conventional and legible, not part of the
   club palette; they can be re-tinted to blue with the same token indirection.
3. Remaining page-level shadow declarations still use literal black alpha.
   They behave correctly in both themes, but routing them through
   `--shadow-xs/sm/md` would be a tidy follow-up.
4. Only the desktop night rendering is a committed baseline; tablet/mobile night
   is reviewed but not baselined, to keep the snapshot set small.
5. `news.html` carries a large amount of legacy article markup with `!important`
   responsive rules. It is themed and passing, but it remains the most fragile
   page for future edits.

## 12. Git diff summary

98 tracked files changed (1,990 insertions, 1,637 deletions) plus new files:

- CSS/JS/templates: `styles.css`, `script.js`, `_includes/head.njk`,
  `_includes/header.njk`, and 14 page templates
  (`index`, `about`, `membership`, `fixtures`, `news`, `gallery`, `contact`,
  `sponsors`, `honours`, `archive`, `history`, `signup`, `live-scoring`,
  `News articles/presentation-dance-2025`, 4 `PhotoAlbums` pages —
  `membership.html`/`signup.html`/`PhotoAlbums/*` changed through shared
  classes rather than their own style blocks)
- tests: `tests/theme.spec.js` (new), `tests/visual-regression.spec.js`,
  `tests/build-output.spec.js`
- tooling: `tools/audit-accessibility.mjs` (four-pass gate),
  `tools/audit-design-system.mjs`, `tools/audit-page-colours.mjs`,
  `tools/audit-inline-styles.mjs`, `tools/audit-header-layout.mjs`,
  `tools/capture-stage9-visuals.mjs`
- baselines and reports: 72 visual baselines, archived Stage 8 visuals,
  refreshed `reports/baseline/measurements/*`, `reports/stage7/accessibility-audit.*`
  and the new `reports/stage9/` review artefacts

The two one-off migration scripts used to convert the legacy colours and inline
styles were removed after use; the audit tools that measure the result are kept.
