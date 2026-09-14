# Image pipeline

Stage 6 replaced "copy every photograph into `_site`" with a build-time image
pipeline. The club's original photographs stay in the repository untouched;
the deployed site serves resized, re-encoded derivatives generated during the
build.

## Where things live

| Path | Purpose |
| --- | --- |
| `Images/**` | **The archive.** Original photographs, never modified or deleted. Not deployed. |
| `_data/*.json` | Structured content (fixtures, honours, gallery, archive, PhotoAlbums, sponsors). Image paths here always point at archive originals. |
| `tools/image-pipeline.mjs` | The pipeline: derivative naming, generation, caching, deployment and reference verification. |
| `.cache/images/` | Content-addressed derivative cache (gitignored) plus `source-index.json` with image dimensions. |
| `_site/Images/**` | Generated derivatives actually deployed. |
| `reports/stage6/source-image-manifest.json` | Read-only record of every archive file (size + SHA-256) captured before optimisation, used to prove originals are untouched. |

## How a build works

1. `npm run build` runs `tools/build-site.mjs`.
2. The pipeline reads dimensions for every archive image (`loadSourceIndex()`).
   Dimensions come from `.cache/images/source-index.json`, which is refreshed
   only for files whose size or modification time changed.
3. Eleventy renders the templates. Image helpers register the exact derivatives
   each page needs and return the public URLs:
   * `{% photoImage %}` – photographic `<img>` with `srcset`, `sizes`, intrinsic
     `width`/`height`, `loading` and `decoding`.
   * `{% photoGraphic %}` – logos and badges, resized but kept in their original
     format.
   * `imageUrl` / `imageSrcset` – used when markup is built in JavaScript
     (the gallery's archive album and the PhotoAlbum grids).
4. `generateSiteImages()` generates only the registered derivatives, publishes
   them into `_site/Images/**`, then scans the built HTML, CSS and JS and fails
   the build if any image reference does not resolve.

## Derivative rules

Widths are driven by the rendered role (see `ROLE_WIDTHS` in
`tools/image-pipeline.mjs`), never by "make everything big":

| Role | Candidates | Used by |
| --- | --- | --- |
| `grid` | 400w, 800w | gallery grids, archive grid, PhotoAlbum grids, album cards, page intro images |
| `content` | 800w, 1600w | article and news imagery |
| `lightbox` | 1600w | Lightbox2 and custom lightbox full-size views |
| `logo` | 112w, 224w | site logo |

Photographs are always converted to WebP. WebP is supported by every browser
the club's audience uses, so a JPEG fallback would double the deployed file
count without helping anyone. AVIF was considered and skipped: it would save a
further ~20% but requires a second full derivative set and `<picture>` markup,
and the artifact is already far below the size target.

Logos and vector marks keep their original format (`imageGraphic` resizes PNG,
JPEG and WebP; `imageOriginal` publishes SVG, favicons and other small assets
unchanged).

Encoder settings (`ENCODER` in `tools/image-pipeline.mjs`):

* WebP – quality 82, effort 4.
* PNG graphics – lossless, `compressionLevel: 9`.
* JPEG graphics – quality 82, mozjpeg.

Images are never upscaled: a derivative is generated at `min(requested, source)`
and EXIF rotation is baked in with `sharp().rotate()`.

## Caching and clean rebuilds

Each derivative is keyed by `source path + size + mtime + width + quality`. If
the key is unchanged the cached file is reused (hard-linked into `_site`), so a
typical rebuild copies files instead of re-encoding ~2,900 images. A full image
build takes a few minutes; a warm rebuild takes seconds.

To force a completely clean rebuild:

```powershell
Remove-Item -Recurse -Force _site, .cache   # generated artifacts only
npm.cmd run build
```

Deleting `.cache` only costs time – the next build regenerates every derivative
from the archive.

## Adding a new photograph

1. Put the original in the right archive folder, e.g.
   `Images/2026/Opening of Green 2026/MyPhoto.jpg`. Do not resize it first.
2. Reference it from content:
   * Gallery: add the file to the album's `sections[].images` entry in
     `_data/gallery.json` (`src` = thumbnail source, `href` = full-size source).
   * PhotoAlbum page: add the filename to `_data/photoAlbums.json`.
   * Archive page: add an entry to `_data/archive.json`.
   * A prose page (news, about, honours…): add
     `{% photoImage "./Images/….jpg", "Alt text", { sizes: "…" } %}`.
3. Run `npm.cmd run build`. The pipeline generates the derivatives, and the
   build fails loudly if any reference is missing.
4. Refresh the archive manifest so future runs keep checking the new file:

   ```powershell
   node tools/write-image-manifest.mjs
   ```

## Auditing

```powershell
node tools/audit-images.mjs      # writes reports/stage6/image-audit.{json,md}
node tools/capture-layout.mjs before   # geometry fingerprint (per page/viewport)
node tools/capture-layout.mjs after
node tools/compare-layout.mjs before after
node tools/analyse-visual-diff.mjs     # magnitude of screenshot differences
```

`IMAGE_PIPELINE_SAMPLE=1` restricts a build to a representative sample (one
gallery image, one PhotoAlbum image, one archive image, one news image, one logo
and the homepage hero) so pipeline changes can be validated quickly before the
whole library is processed.

## Exclusions from source control

`_site/` and `.cache/` are generated and ignored. Only the archive, the data
files, templates, tooling and the audit/manifest reports are committed.
