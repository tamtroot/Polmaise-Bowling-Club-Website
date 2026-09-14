# Release procedure

## 1. Prepare

```powershell
git status                 # expect a clean tree (or only intended changes)
npm ci                     # exact dependency versions
```

## 2. Verify locally

```powershell
npm test                   # build + structure, links, images, a11y/SEO, visual, interactions
```

Expected: all tests pass except the six accepted Stage 6 PhotoAlbum screenshot
differences (`Album: Presentation Dance / Charlie McNeil / Twa Peters` at tablet
and mobile), which are image-encoding only and are documented. Do not update
baselines to silence them.

Optional but recommended for a release:

```powershell
node tools/audit-accessibility.mjs   # expect 0 axe violations on all 18 pages
node tools/audit-repository.mjs      # dead selectors, deployment leaks
```

## 3. Check the artifact

```powershell
Get-ChildItem _site -Recurse -File | Measure-Object Length -Sum
# ~2,950 files, ~243 MiB; images ~2,924 files / ~240 MiB
```

Also confirm:

- `_site/sitemap.xml` lists 18 URLs and `_site/robots.txt` points at it;
- no `Images/`, `_data/`, `_includes/`, `tools/`, `tests/`, `reports/` or
  `README.md` content is present in `_site`;
- the build printed `2025 references verified` (or the current equivalent).

## 4. Release

```powershell
git tag vYYYY.MM.DD            # optional but useful for rollback
git push origin main --tags
```

The `Deploy static content to Pages` workflow runs on `main`:
`npm ci` → `npm run build` → `npm test` → upload `_site` → deploy. A failed build
or test stops the deployment before anything is published.

## 5. Verify the deployment

1. Open the site from the Pages URL (or `https://polmaisebowlingclub.com`) and
   confirm the home page, one gallery album, one PhotoAlbum, the fixtures table
   and the archive load with images.
2. Check `…/sitemap.xml` and `…/robots.txt` are reachable.
3. Confirm no console errors beyond the known third-party Live Scoring message.

## 6. Rollback

The site is a static artifact, so rollback is a redeploy of a previous commit:

```powershell
git revert <commit>            # or: git checkout <previous-tag> && git push
git push origin main
```

The workflow rebuilds and redeploys automatically. To republish an exact
previous build, re-run the workflow from the Actions tab for that commit
(`Run workflow` → select the branch/commit).

## Notes

- Never edit `_site` by hand; it is generated and gitignored.
- `Images/` is the club archive: releases never modify, move or delete originals.
- If a release only changes content data (`_data/*.json`), the image cache makes
  the build fast; a full rebuild is only needed when source images change.
