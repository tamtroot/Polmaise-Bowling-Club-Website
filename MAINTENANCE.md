# Maintenance guide

Everything below is edited in the repository; the site is rebuilt by
`npm.cmd run build` (or automatically by GitHub Actions on push to `main`).

## Fixtures

Edit `_data/fixtures.json`. Each record drives both the desktop table row and
the mobile card, so they can never drift apart:

```json
{ "date": "04-Apr", "competition": "Opening of Green", "day": "Saturday",
  "venue": "Polmaise", "status": "Confirmed" }
```

`status` is free text and becomes the badge class: `Confirmed`, `TBC`,
`Proposed`, or `—` for a blank fixture. Keep the array in date order — the page
greys out past fixtures and highlights the next one from the same order.

## News

News articles are prose and stay in `news.html`:

1. Duplicate a card block in the relevant list (`#latest-news` for the current
   season or the 2025 list) and set `data-news-article` to a unique id.
2. Duplicate the matching `<article id="…">` block further down the page with the
   same id, so the card opens it.
3. Images inside cards and articles use
   `{% photoImage "./Images/…", "Alt text", { sizes: "…" } %}`.

For a full-page article instead, copy `News articles/presentation-dance-2025.html`,
update the front matter (`pageTitle`, `metaDescription`, `permalink`, `prefix:
"../"`) and link it from a card with `data-href`.

## Gallery albums

`_data/gallery.json` holds two things:

- `cards` — the album tiles. Use `open` for an album rendered on the same page,
  or `link` for a card that navigates (e.g. a PhotoAlbum page).
- `albums` — each album's `id`, `title`, `sections[].images` and close button.

An image record is `href` (full-size source), `src` (grid source), `alt`, and
optionally `title`, `caption`, `decoding`, `width`/`height`, `extraClass`.
Add `{ "heading": "…" }` sections to group photos under a sub-heading.

The archive album (`album7`) is generated in `gallery.html` from
`Images/Archive/Photo N.jpg` / `Photo N-thumb.jpg`; if you add archive photos,
extend the loop bounds and the derivative-registration loop above it together.

## PhotoAlbum pages

Add the filenames to `_data/photoAlbums.json` under the album's key:

```json
"presentation-dance-2025": {
  "galleryId": "presentation-gallery",
  "directory": "../Images/2025/PresentationDance2025/",
  "group": "presentation-2025",
  "titlePrefix": "Presentation Dance 2025 - Photo ",
  "altPrefix": "Presentation Dance 2025 - Photo ",
  "images": ["20251025_200718.jpg"]
}
```

Order matters: photos appear in array order and captions are numbered from it.

## Honours

`_data/honours.json`:

- `years` — newest first. Each has `achievements[]` and optionally
  `competitionHeading` + `competitions[{ name, winner }]`. A year with only
  `note` renders the note instead of a list (used for 2020).
- `presidents`, `champions`, `ladiesChampions` — `columns[][]` of
  `{ year, name }`, plus optional `emphasis` (italic note) and `current` flags.

Add a new season at the top of `years` and append the new office-holders to the
last column of the relevant board.

## Sponsors

`_data/sponsors.json` has `main` (large cards, optional `banner`) and `club`
(business cards, optional `logo`). A contact is
`{ "icon": "fas fa-phone", "text": "…" }` or
`{ "icon": "fas fa-globe", "text": "…", "href": "https://…", "target": "_blank" }`.
Logos are resized in their original format by `{% photoGraphic %}` — keep using
PNG/SVG for logos rather than photographic formats.

## Images

1. Drop the original into the right folder under `Images/` (do not pre-resize).
2. Reference it from data (gallery/archive/PhotoAlbums) or from a template with
   `{% photoImage "./Images/…", "Alt text", { sizes: "…" } %}`.
3. Run `npm.cmd run build`; derivatives are created automatically and the build
   fails if a reference is missing.
4. Run `node tools/write-image-manifest.mjs` so the archive-preservation check
   covers the new file.

## Common troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Image pipeline produced N unresolved reference(s)` | a template or data file points at a file that is not in `Images/`; the message lists the missing paths |
| Images appear as broken icons on one page | usually a stale server serving an old `_site`; stop it and rebuild |
| `EBUSY`/`EPERM`/`Access is denied` while cleaning `_site` | a cloud-sync client is holding generated files; exit/pause syncing, delete `_site`, rebuild, or use `SITE_ROOT`/`IMAGE_CACHE_ROOT` |
| Visual test fails after an image change | run `npm run test:visual` and inspect the diff artefacts in `test-results/`; only update baselines with `npm run baseline:update` once the change is approved |
| Fixtures page looks wrong on a specific day | fixture styling is date-driven; tests freeze the clock, the live site does not |
| Live Scores shows a service error | the embedded third-party score service is unavailable; the rest of the site is unaffected |

## Known product decisions (do not "fix" silently)

- There is no login, signup backend or contact form: `signup.html` is a
  front-end-only demo and its success alert deliberately no longer redirects to a
  non-existent `login.html`.
- The gallery card **Club Events and Achievements** (`album5`) opens nothing
  because no album with that id has ever existed in this repository. Content
  ownership was never defined, so it is left for a content decision.
- Twitter/Instagram/YouTube icons are decorative: the club has no verified URLs
  for them, so they are not links.
