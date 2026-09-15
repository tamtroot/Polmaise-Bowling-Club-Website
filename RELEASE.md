# Release procedure — v2.0

This release is the refactored Polmaise Bowling Club website (Stages 0–16): a
static Eleventy site with a premium homepage, Polmaise day/night branding, a
generated news archive, a rebuilt fixtures page and a new historical archive.

Nothing here is executed automatically. Merging, tagging and deploying need
explicit approval.

## 1. What ships

| | |
| --- | --- |
| Branch | `deepseek-v41-refactor` (9 commits ahead of `origin/main`, 0 behind) |
| Production output | `_site` — the only path the Pages workflow uploads |
| Pages | 68 HTML pages: 18 hand-written (17 public + `signup.html`) and 50 generated news pages |
| Images | 2,945 derivatives + 12 graphics + 3 copied originals from 1,914 source files |
| Artifact | 3,051 files, 243.5 MiB (GitHub Pages limit is 1 GiB) |

## 2. Prepare

```powershell
git status                      # expect only intended changes
npm ci                          # exact dependency versions
Remove-Item -Recurse -Force _site, .cache   # genuinely clean build (optional but recommended)
```

## 3. Verify locally (the same commands the workflow runs)

```powershell
npm run build                   # ~13s warm, ~4min cold (image derivatives are rebuilt)
npm test                        # build + full Playwright suite
```

Expected: **0 failures**. The suite covers structure and deployment, internal
links, image references, HTML validation, axe accessibility (day/night ×
desktop/mobile), SEO + sitemap, theme switching, keyboard access, rapid
navigation, the homepage fixture states, the news architecture, the fixtures UX
states and the historical archive, plus visual baselines for every public page.

Optional release audits:

```powershell
node tools/audit-accessibility.mjs   # expect 0 axe violations in all four combinations
node tools/audit-header-layout.mjs   # expect 0 header collisions
node tools/audit-repository.mjs      # dead selectors and deployment leaks
node tools/audit-seo-release.mjs     # expect "problems: 0" across all 68 pages
```

## 4. Check the artifact

```powershell
Get-ChildItem _site -Recurse -File | Measure-Object -Property Length -Sum
```

Confirm:

- 3,051 files, ~243 MiB, 68 HTML pages, 2,957 image derivatives;
- `_site/sitemap.xml` lists 68 URLs and `_site/robots.txt` points at it;
- no `_data/`, `_includes/`, `tools/`, `tests/`, `reports/`, `node_modules/` or
  `_site*` directory inside `_site`;
- the build printed `2201 references verified`;
- the footer shows the current year (it is rendered from the build year).

## 5. Release commands

```powershell
# 1. commit the release work on the feature branch
git add -A
git commit -m "Stage 16: release hardening for v2.0"

# 2. bring main up to date and fast-forward it (origin/main is an ancestor)
git switch main
git pull --ff-only
git merge --ff-only deepseek-v41-refactor      # fast-forward, no merge commit

# 3. final verification on main
npm ci
npm test

# 4. publish
git push origin main
git tag -a v2.0 -m "v2.0 — refactored site: homepage, day/night branding, news architecture, fixtures UX, historical archive"
git push origin v2.0
```

A fast-forward is possible because `origin/main` (`647d89b`) is a direct
ancestor of the branch. If the branch is ever not a fast-forward, use
`git merge --no-ff` so the release stays a single reviewable merge commit.
Never force-push `main`.

## 6. Deployment

`.github/workflows/static.yml` runs on a push to `main` (and by manual dispatch):
checkout → configure Pages → Node 22 → `npm ci` → install Chromium → `npm test`
→ upload `_site` → deploy. A failing test stops the deployment, so nothing
broken is published. The run takes roughly 10–15 minutes, most of it the cold
image build.

Screenshot baselines are per platform, so the gate compares against the Linux
set (`tests/__screenshots__/**-linux.png`). If the run reports missing or
mismatched screenshots, generate and review that set with the manual *Generate
Linux visual baselines* workflow before re-running the deployment
(MAINTENANCE.md → *Visual baselines (platform-specific)*).

## 7. Rollback

```powershell
git switch main
git revert --no-edit <release-commit>     # or: git reset --hard <previous-commit>
git push origin main                      # re-deploys the previous content
```

Alternative for a content-only rollback: re-run the workflow from the previous
green commit in the Actions tab ("Re-run all jobs" on the last deployment before
the release).

Previous production state: `647d89b` on `main` ("Added Chucks memorial").

After a rollback, verify:

- the homepage loads and the hero image is present;
- `news.html` still lists stories and `/news/2026/` resolves;
- `fixtures.html` shows its season summary;
- `sitemap.xml` responds and `robots.txt` points at it;
- day/night toggle still persists across pages;
- the browser console is free of new errors (the live-scoring 401 may appear).

## 8. Post-deployment smoke test (run on https://polmaisebowlingclub.com)

Home — hero image and headline; "Latest from Polmaise" cards link to articles;
fixture state matches the season; gallery strip images; membership photograph;
sponsor logos legible.

Themes — switch to night and back; reload keeps the choice; open three pages in
night mode; check for white islands.

Navigation — desktop links (Home, About, Membership, Fixtures, News & Events,
Gallery, Contact, Sponsors, Honours); burger drawer below 1280px; every link
opens the right page.

News — landing page (featured, latest, more news, categories, archives);
one 2026 article; the 2025 archive; a category page; the historical archive and
one historical article (image + caption intact).

Fixtures — summary strip (latest result / next fixture / season status);
"Show earlier fixtures" expands and collapses; mobile card layout at 375px.

Technical — browser console (only the accepted live-scoring 401 is allowed);
no broken images; no 404s from internal links; `sitemap.xml` and `robots.txt`
reachable; canonical URLs correct; HTTPS padlock; favicon; social preview
metadata; footer year correct.

## 9. Release notes (v2.0)

- **Homepage** rebuilt as an editorial front page: photographic hero, at-a-glance
  strip, latest news, this week at the club, club history, gallery, membership
  invitation and sponsors.
- **Polmaise day/night branding** across every page, with the choice remembered
  between visits and no flash of the wrong theme.
- **Responsive redesign** of all public pages, including a mobile drawer and
  card layouts on small screens.
- **News architecture**: every article is its own page with a landing page,
  year archives, category pages, automatic sitemap entries and the homepage
  "latest three" generated from the same files.
- **Historical archive**: a single-rail chronology with year chapters, uncropped
  imagery and a distinct newspaper-cutting treatment.
- **Fixtures UX**: season summary, month grouping, next-fixture highlighting and
  collapsed earlier fixtures that still work without JavaScript.
- **Image pipeline**: build-time derivatives, responsive `srcset`, a hash cache
  and a reference check that fails the build on a missing image.
- **Accessibility**: skip link, visible focus, keyboard-operated menus,
  accordions, lightbox and fixture collapse; axe reports zero violations in day
  and night at desktop and mobile widths.
- **SEO**: unique titles and descriptions, canonicals, Open Graph/Twitter
  metadata, article JSON-LD, sitemap and robots.
- **Automated tests**: 300+ Playwright checks across structure, links, images,
  HTML validity, accessibility, SEO, themes, interactions, generated sections
  and visual baselines.
- **Performance**: self-hosted fonts and libraries, WebP derivatives, no
  third-party CDN on the critical path.
- **Navigation reliability**: metric-matched font fallback and preloaded webfonts
  so the header cannot re-flow under a click during the font swap.
