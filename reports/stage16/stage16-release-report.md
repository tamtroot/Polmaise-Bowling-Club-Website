# Stage 16 — Production Readiness & Release (v2.0)

No pushes, merges, tags or deployments were performed. Everything below is
local verification plus the plan, which lives in [RELEASE.md](../../RELEASE.md).

## 1. Git state

| | |
| --- | --- |
| Branch | `deepseek-v41-refactor` |
| HEAD | `978394d` "Fix navigation font-swap layout shift and drawer pageshow timing" |
| `origin/main` | `647d89b` "Added Chucks memorial" (local `main` matches) |
| Ahead / behind | **9 ahead, 0 behind** → `main` can fast-forward |
| Working tree | dirty: 174 entries (95 modified, 79 untracked) — Stages 12–16 are uncommitted |
| Tracked generated artefacts | none (`git ls-files | grep _site` is empty) |
| Ignored build/cache dirs present | `_site`, `_site-alt` (locked, empty), `.cache`, `.cache-alt`, `node_modules`, `test-results`, `playwright-report` |

No history rewriting or squashing was done. Proposed commit boundaries are in
§12.

## 2. Clean build from scratch

`_site`, `_site-alt`, `.cache`, `.cache-alt`, `test-results` and
`playwright-report` were deleted, then the canonical production command was run:
`npm run build` → `node tools/build-site.mjs` into `_site` with the default
`.cache/images` (cold, so every derivative was regenerated).

| | |
| --- | --- |
| Duration | **257.7 s (4.3 min)** cold, 12.6 s warm |
| Files written | 3,051 |
| HTML pages | 68 |
| Image derivatives | 2,945 + 12 graphics (2,957), 3 originals copied |
| Output size | 243.5 MiB (images 239.7 MiB) |
| Warnings | none |
| Reference check | `2201 references verified` |

Verified afterwards: no nested `_site*` directory inside the output, no
`_data/`, `_includes/`, `tools/`, `tests/`, `reports/`, `node_modules/`,
`package.json` or `_site*` leak, and only the intended public files at the root
(18 pages, `news/`, `News articles/`, `PhotoAlbums/`, `Images/`, `vendor/`,
`downloads/`, `styles.css`, `script.js`, `sitemap.xml`, `robots.txt`).

## 3. Full regression suite

`npx playwright test` against `_site` (the workflow's own command):

**308 passed, 205 skipped, 0 failed** (6.7 min).

Covered: build/structure and deployment, HTML validation, internal links, image
references, axe accessibility (day/night × desktop/mobile), SEO + sitemap,
themes, keyboard accessibility, rapid navigation, external-dependency
resilience, navigation hit targets, homepage fixture states, news architecture,
fixtures UX states and the historical archive, plus visual baselines.

## 4. Public page inventory

68 HTML pages: 18 at the root (17 public pages plus the `signup.html` demo) and 50
generated news pages (43 articles, 2 year archives, 4 category pages, the
historical archive index).

Reachability crawl from `/`: **65 of 68 reachable**. The three that are not
linked from anywhere are:

| Page | Classification |
| --- | --- |
| `/News articles/presentation-dance-2025.html` | legacy page retained deliberately (Stage 13), reachable by URL and in the sitemap → **backlog** (link it or treat as archived) |
| `/PhotoAlbums/top-15-final-2025.html` | album page not linked from the gallery → **backlog** (same decision) |
| `/signup.html` | front-end-only demo, deliberately unlinked (documented product decision) → **product decision** |

No duplicate pages, no unintended public pages, and no stale generated pages
were found. `sitemap.xml` lists exactly the 68 pages (`missing 0 / unexpected 0`)
and `robots.txt` points at it.

## 5. Content-currency findings

| Finding | Classification | Action |
| --- | --- | --- |
| Footer showed `© 2025` | **safe factual fix** | now rendered from the build year (`buildYear` in `eleventy.config.js`); the 18 Stage 2A reference copies were refreshed |
| Fixtures season is 2026 and the page derives everything from `season` | historically correct | none |
| Printable download links the 2026 PDF; the 2025 PDF stays as a secondary link | safe factual fix (done in Stage 14) | none |
| Homepage season-complete copy names the 2026 season and its final date from data | correct | none |
| `news.html` description mentions the 2026 and 2025 archives | correct | none |
| `gallery.html` JS branch tests a button label `"Back to 2025"` that no longer exists (buttons say "Back to Gallery") | dead code | **backlog** (harmless: the fallback branch runs and the gallery tests pass) |
| `about.html` 2025 timeline entries and 2025 archive photographs | historically correct | none |
| News article dates in 2025/2026 and the historical archive's 1911–2013 dates | historically correct | none |
| Sponsor and membership wording | current | none |
| No stale navigation labels, event notices or "current season" wording found | — | none |

## 6. Live Scoring outcome

The iframe embed to `polmaise-bowls-live.base44.app` is kept, and the page now:

- states honestly that "if the board does not load, live scoring may be
  unavailable — please check back later for match updates" (the previous copy
  claimed "there are no live games at the moment", which was wrong when the
  service was failing);
- shows a "Live scoring is currently unavailable" panel, with the outbound link,
  if the board never finishes loading (single 10-second wait, no retries, no
  polling);
- drops `loading="lazy"` on that one frame so the wait measures the real request.

**Documented limitation:** a cross-origin 401 renders *inside* the frame and
still fires `load`, so the page cannot detect it. The honest static copy covers
that case; the probe covers "service unreachable". No authentication is bypassed
and no third-party behaviour is reverse-engineered. Regression coverage:
`tests/live-scoring.spec.js` (embed + copy, the fallback with a stalled request,
and the expand/exit controls). The single `401` console message remains the only
accepted recurring console error.

## 7. Accessibility result

- `node tools/audit-accessibility.mjs`: **0 axe violations** in all four
  combinations (day desktop, day mobile, night desktop, night mobile) across the
  25 audited pages; 0 pages missing a description, canonical, `<main>` or single
  `<h1>`; no duplicate titles.
- Full-site visual sweep (120 captures, all public pages × day/night ×
  desktop/tablet/mobile): 0 horizontal overflow, 0 broken images, 0 page errors;
  the only console message is the known live-scoring 401.
- Page-level capture tools for the news, fixtures and archive sections: 0 axe
  violations in day/night × desktop/mobile.

## 8. Link / image / SEO result

| Check | Result |
| --- | --- |
| Internal links | 2,763 references checked, **0 missing**, 6 known placeholder links |
| Image references | 2,864 checked, **0 broken**, 0 unresolved |
| HTML validation | 68 pages, 12 findings (7 unique, all pre-existing legacy), 0 new |
| Titles / descriptions / canonicals | 68 pages, **all unique**; 0 problems |
| Social metadata + JSON-LD | present and valid on all 68 pages |
| Dev URLs / `noindex` | none found |
| Sitemap | 68 = 68, 0 missing, 0 unexpected; robots references it |
| Header collision probe | 550 checks, 0 problems |

## 9. Performance summary

Desktop 1440×900, day theme, from the recorded page measurements:

| Page | Requests | Transferred | HTML | Images | CSS | JS |
| --- | --- | --- | --- | --- | --- | --- |
| Home | 23 | 1,245 KiB | 49 KiB | 588 KiB | 163 KiB | 11 KiB |
| News landing | 15 | 788 KiB | 29 KiB | 152 KiB | 163 KiB | 11 KiB |
| 2026 article | 13 | 960 KiB | 16 KiB | 336 KiB | 163 KiB | 11 KiB |
| Fixtures | 11 | 719 KiB | 108 KiB | 4 KiB | 163 KiB | 11 KiB |
| Gallery | 40 | 1,479 KiB | 313 KiB | 459 KiB | 165 KiB | 107 KiB |
| History | 11 | 644 KiB | 32 KiB | 4 KiB | 163 KiB | 11 KiB |
| Historical archive | 20 | 939 KiB | 27 KiB | 305 KiB | 163 KiB | 11 KiB |

Obvious waste checked: no duplicate font downloads (fonts are self-hosted and
preloaded only where needed), no full-resolution originals deployed, no unused
external libraries introduced, and no duplicated asset requests. The shared
stylesheet transfers 163 KiB on every page, of which **100 KiB is Font Awesome's
`all.min.css`** plus 254 KiB of Font Awesome WOFF2 for the ~30 glyphs used.

## 10. Font / icon payload review

- Shipped: `all.min.css` 100,307 B, `fa-solid-900.woff2` 150,020 B,
  `fa-brands-400.woff2` 109,808 B (~355 KiB with the CSS).
- Only the solid and brands faces are shipped (no regular/light faces), and both
  are used (interface icons and the footer brand glyphs).
- Both brand and solid glyphs are needed, and every referenced `fa-*` class is
  generated from templates, so a meaningful reduction requires WOFF2 subsetting
  (a Python font toolchain in CI) plus a guard that fails when a new icon is
  added. That is a maintenance burden for a marginal saving at release time, so
  it is **documented and deferred** (MAINTENANCE backlog) rather than risked now.

## 11. Visual release review

Full-site sweep (120 captures) plus the section-specific capture tools for news
(Stage 13), fixtures (Stage 14) and the archive (Stage 15):

- no clipping or overflow at 375/768/1024/1440 in either theme;
- no white islands reported in night mode beyond the tool's long-standing
  heuristics (the same signals as the previously accepted run, scaled to the
  larger capture set);
- no broken images and no stale gold/green fragments beyond the design system's
  intentional brass accents;
- sticky header behaves on every page, with the article title staying in flow;
- sponsor logos legible inside equal cards; theme persists across pages.

## 12. Deployment workflow

`.github/workflows/static.yml` (unchanged): push to `main` or manual dispatch →
`actions/checkout@v4` → `configure-pages@v5` → Node **22** with npm cache →
`npm ci` → `npx playwright install --with-deps chromium` → **`npm test`** →
`upload-pages-artifact@v3` with `path: '_site'` → `deploy-pages@v4`. Concurrency
is "pages" without cancellation; the job timeout is 30 minutes.

Findings: correct Node version, exact install, single test gate that builds
`_site` itself, correct artifact path, branch trigger is `main` only, no stale
static-root behaviour, and no development directory is uploaded. The local
equivalent (`npm run build` then `npx playwright test` into `_site`) was
performed above and matched. **No workflow changes are required.**

Residual risk to watch on the first CI run: the visual baselines were last
regenerated on Windows, so cross-platform font rasterisation is the one thing
that cannot be proven locally. Playwright's per-pixel `threshold: 0.2` and
`maxDiffPixelRatio: 0.002` are designed for that noise; if any baseline does
differ on Linux, regenerate it on the runner with
`npx playwright test --update-snapshots` and review the diff.

## 13. Release notes and recommended version

Release notes are in [RELEASE.md](../../RELEASE.md#9-release-notes-v20).
Recommended tag: **`v2.0`** (major presentation and architecture change, same
public URLs and content model).

## 14. Merge / push / tag commands (not executed)

```powershell
git add -A
git commit -m "Stage 16: release hardening for v2.0"
git switch main
git pull --ff-only
git merge --ff-only deepseek-v41-refactor
npm ci
npm test
git push origin main
git tag -a v2.0 -m "v2.0 — refactored site"
git push origin v2.0
```

The fast-forward is safe because `origin/main` is an ancestor of the branch. If
that changes, use `--no-ff` so the release is one reviewable merge commit.

If the team prefers history that matches the stages, use these boundaries
(whole files only — a few files carry changes from more than one stage, so they
are grouped with the shared-infrastructure commit):

1. `Stage 12: homepage redesign` — `index.html`, `_data/homepage*.{js,json}`,
   `_data/fixtures.json`, `Images/Try Bowls.png`, homepage tests, `home-*`
   baselines, `reports/stage12/`, `reports/baseline/visual/stage12-initial/`.
2. `Stage 13: news architecture` — `news/**`, `_data/newsArchive.js`,
   `_includes/news-article.njk`, `news.html`, `news/*.njk`, the `tools/*news*`
   and title/date helpers, `tests/news-architecture.spec.js`, the news baselines
   and `reports/stage13/`.
3. `Shared infrastructure` — `styles.css`, `_includes/head.njk`,
   `_includes/header.njk`, `eleventy.config.js`, `.gitignore`,
   `tools/build-site.mjs`, `tools/static-server.mjs`, the updated specs and
   helpers, `reports/stage-2a/**` and the refreshed baseline measurements.
4. `Stage 14: fixtures UX` — `fixtures.html`, `_data/fixtureSchedule.js`,
   `tools/fixture-schedule.mjs`, `tools/capture-stage14-visuals.mjs`,
   `tests/fixtures-ux.spec.js`, fixtures baselines, `reports/stage14/`.
5. `Stage 15: historical archive` — `history.html`, `tools/news-excerpts.mjs`,
   `tests/historical-archive.spec.js`, history/archive baselines,
   `reports/stage15/`.
6. `Stage 16: release hardening` — `README.md`, `ARCHITECTURE.md`,
   `MAINTENANCE.md`, `RELEASE.md`, `_includes/footer.njk`, `live-scoring.html`,
   `tests/live-scoring.spec.js`, `tools/audit-seo-release.mjs`, live-scoring
   baselines, `reports/stage16/`.

## 15. Rollback

Previous production state: `647d89b` on `main`.

```powershell
git switch main
git revert --no-edit <release-commit>     # revert the release
git push origin main                      # redeploys the previous content
```

Or re-run the last green deployment from the Actions tab. After rolling back,
verify the homepage, `news.html` + `/news/2026/`, `fixtures.html`,
`sitemap.xml`/`robots.txt`, the theme toggle and the console. Full procedure in
[RELEASE.md](../../RELEASE.md#7-rollback).

## 16. Production smoke-test checklist

In [RELEASE.md](../../RELEASE.md#8-post-deployment-smoke-test-run-on-httpspolmaisebowlingclubcom):
home, themes, navigation, news, fixtures and technical checks (console, images,
404s, sitemap, robots, canonicals, HTTPS, favicon, social metadata).
**Production smoke testing has not been performed** — it can only run after
deployment.

## 17. Launch blocker classification

| # | Item | Class |
| --- | --- | --- |
| 1 | Everything in the release gate: build, 308 tests, axe (0 violations in four combinations), links (0 missing), images (0 broken), SEO (0 problems), sitemap, header collisions | **no blocker** |
| 2 | Live-scoring 401: documented limitation, honest copy and a fallback panel; embed preserved | **no blocker** (accepted third-party dependency) |
| 3 | Cross-platform visual baselines unproven on Linux until the first CI run | **SHOULD FIX if it appears** (regenerate on the runner) |
| 4 | Fixtures PDF path is still literal in `fixtures.html` (must be repointed each season) | **SHOULD FIX** (small; next content pass) |
| 5 | Gallery page weight (313 KiB HTML + ~96 KiB inline JS + 459 KiB images) | **SHOULD FIX** (worth splitting album data out) |
| 6 | Font Awesome payload (~355 KiB per cold visit) needs subsetting with a build guard | **BACKLOG** |
| 7 | Two legacy pages reachable only by URL (`News articles/presentation-dance-2025.html`, `PhotoAlbums/top-15-final-2025.html`) | **BACKLOG** |
| 8 | `signup.html` in the sitemap but unlinked | **PRODUCT DECISION** |
| 9 | `gallery.html` dead `"Back to 2025"` branch | **BACKLOG** (technical debt) |
| 10 | Fixture calendar export (`.ics`) blocked on times; fixture filtering deferred | **BACKLOG** |
| 11 | Historical scans that could be re-scanned; two short historical excerpts derived from limited source text | **BACKLOG** |
| 12 | Social icons remain decorative (no verified URLs) | **PRODUCT DECISION** |

**0 blockers**; 2 should-fix items that are safe to ship and address next; 6
backlog items; 2 product decisions owned by the club.
