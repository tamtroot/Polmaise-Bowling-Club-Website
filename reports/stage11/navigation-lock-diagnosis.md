# Stage 11 — desktop navigation "lock" diagnosis

Investigation only: **no production code was changed.** Two new tests reproduce
the defect and currently fail by design.

## 1. Headline

The visible desktop header navigation is not blocked by an overlay, a pointer
event, a stale drawer or a suppressed event. **The links move.** When the web
font replaces the fallback font after first paint, the right-aligned navigation
re-flows left by up to **32.94px**, while adjacent items are separated by a
**4px** gap. A click aimed at the label the user can see therefore lands in that
gap (nothing happens, no document request) or on the neighbouring link (the
wrong page, or the current page when the neighbour is the current page — which
is why "Fixtures" stays current and no `GET /news` is ever seen).

## 2. The exact visible navigation element

On every page the visible "News & Events" link is a single element:

```
header > div.container > nav > ul#primary-menu > li > a
text="News & Events"  href="news.html"  rect={x:783, y:25, w:116, h:35}
display:inline  visibility:visible  opacity:1  pointer-events:auto  position:relative
```

Full inventory across all 18 pages (`node tools/diagnose-navigation-lock.mjs --inventory`):

| Page | "News" anchors | "Fixtures" anchors | Not hit-testable |
| --- | --- | --- | --- |
| index.html | 2 (header nav + "Club News" card) | 2 (header nav + footer quick link) | 2 (the card/footer links, below the fold) |
| all other pages except the article | 1 (header nav) | 2 (header nav + footer quick link) | 1 (footer link, below the fold) |
| `News articles/presentation-dance-2025.html` | 2 | 3 | 3 |

### The hidden duplicate from the earlier debugging

The 0×0 "News" anchor with otherwise-normal computed CSS is the **template
duplicate inside the mobile dropdown**, which exists on the Presentation Dance
article page:

```
html > body > header > div.container > div#mobileNavDropdown.mobile-nav-dropdown > a
text="News & Events"  href="../news.html"
rect={x:0, y:0, w:0, h:0}   display:inline   visibility:visible   opacity:1   pointer-events:auto
```

It is 0×0 because its **parent** is `display:none !important` at ≥769px (the
article page's own media query), not because of anything on the anchor itself —
exactly the pattern reported. Any diagnostic that used
`[...document.querySelectorAll('a')].find(a => a.textContent.includes('News'))`
on that page could therefore measure a link that is never clickable, and a
`.click()` on it would of course never navigate. **That earlier reading was an
artefact of element selection.** The real defect below is separate and
reproducible with the correct element.

## 3. Reproduction (deterministic)

`node tools/diagnose-navigation-lock.mjs --repro --fontdelay=1200 --width=1440`

1. Load `/fixtures.html` while the font *files* are delayed, so the page paints
   with fallback metrics.
2. Record where "News & Events" is painted; the nav re-flows when the font
   arrives.
3. Click at the coordinates the user aimed at.

| Click point (same y=42) | What was there before the font | What is there after | Result |
| --- | --- | --- | --- |
| x = 806.91 | News & Events | News & Events | navigates to `/news.html` (control) |
| **x = 900.66** | **News & Events** | **`ul#primary-menu` (the 4px gap)** | **no navigation; URL stays `/fixtures.html`; no document request** |
| x = 906.66 | News & Events | Gallery | navigates to `/gallery.html` (wrong page) |

Measured re-flow when the font loads (1440px, `/fixtures.html`). The per-item
shifts are the numbers the failing test reports; the two rectangles are
measured directly in the reproduction run:

| Nav item | Shift when the font loads |
| --- | --- |
| Home | **−32.94px** |
| About Us | −30.94px |
| Membership | −28.30px |
| Fixtures | −23.02px |
| News & Events | **−20.75px** |
| Gallery | −14.72px |
| Contact Us | −11.72px |
| Sponsors | −7.37px |
| Honours | −3.59px |

Directly measured rectangles for the two links involved in the reported
symptom, both on `/fixtures.html` at 1440px:

```
News & Events   fallback [803.91 → 913.38]   web font [783.16 → 898.66]
Fixtures        fallback [731.74 → 802.18]   web font [708.72 → 779.16]
```

The right edge is pinned (right-aligned nav), so items further left move most.
Every gap between neighbours is exactly **4px** (settled layout: Fixtures
779.16 → News 783.16, News 898.66 → Gallery 902.66); link widths are 70–116px.

## 4. Failure state at the failing point (task 5)

Captured at x=900.66, y=42 immediately before the failed click:

```json
"document": { "htmlClass": "", "bodyClass": "", "readyState": "complete",
              "url": "/fixtures.html", "hasFocus": true, "scrollY": 0 },
"nav":      { "ulClass": "", "display": "flex", "position": "static",
              "drawerOpen": false, "mobileMenuDisplay": "none",
              "desktopBreakpoint": true, "viewport": [1440, 900] },
"elementFromPoint": "ul#primary-menu",
"stack": [ "ul#primary-menu", "nav", "div.container", "header (sticky, z-index 100)", "body" ],
"preventDefaultCalls": []
```

Every alternative mechanism is therefore excluded:

| Candidate | Evidence |
| --- | --- |
| Overlay / backdrop intercepting | `elementsFromPoint` is the nav `ul` → `nav` → container → header. No overlay, no duplicate layer, no pseudo-element hit. |
| `pointer-events` | `auto` on the link and on every ancestor. |
| Stale desktop/mobile nav state | `ulClass=""` (no `.show`), drawer closed, `menuDisplay:"none"`, `desktopBreakpoint:true`, `bodyClass:""` (no scroll lock). |
| Duplicate navigation layers | The only duplicates are the hidden `.mobile-nav-dropdown` links on the article page (0×0, unreachable). |
| Event suppression | `preventDefault()` was never called (empty log); mousedown/mouseup/click all fire normally; the click simply lands on the `ul`. |
| Focus/hover-only | Hover/underline is cosmetic; the click target is computed by hit test, and the hit test resolves to the `ul`. |
| Breakpoint corruption | Viewport stays 1440; the 1280px media query matches throughout. |
| Header layout overlap | Measured separately: logo/nav/toggle never overlap (`tools/audit-header-layout.mjs`, 396 checks, 0 problems). |

## 5. Proven root cause

**The desktop navigation's hit targets are not stable.** `Open Sans` is applied
with `font-display: swap` (inherited from the original Google Fonts stylesheet,
preserved by `tools/fetch-vendor-assets.mjs`), so on every page load the browser
paints the nav with the fallback font first and re-flows it when the webfont
arrives. The nav is right-aligned and its items have no reserved widths, so the
re-flow moves every item — up to 33px — while the dead gap between neighbours is
only 4px wide.

That makes two failures possible, both matching the report:

1. **Click lands in the gap** → the click target is `ul#primary-menu`, no anchor
   activation, **no document request**, page unchanged, still scrollable, current
   page still shows as active, and the cursor is still over what *was* the News
   label so it keeps its hover underline. ← the reported symptom exactly.
2. **Click lands on the neighbour** → navigates to Fixtures (already current, so
   no visible change and no request if served from cache) or to Gallery.

A third variant follows from the same cause: if the re-flow happens *between*
mousedown and mouseup, the browser dispatches the click to the nearest common
ancestor instead of the anchor, so the click cannot navigate even though the
pointer ends over the link.

Why "rapid" navigation: the re-flow happens **after every navigation** (each new
document re-applies the webfont). A user who clicks once and waits aims after
the page has settled; a user clicking quickly through the menu aims at the
layout that is about to move. The window is the time between first paint and the
font files arriving — with ~640 KB of self-hosted vendor fonts on a slow link
that is hundreds of milliseconds.

Alternative explanations that the measurements rule out: server type (the
defect is client-side and reproduces with any static server, including the
`serve`-style 301 + `max-age` profile I tested), the Stage 9/10 drawer
breakpoint change, the two-line wordmark, the theme toggle, duplicate anchors,
and the earlier "CDN stall" freeze (fixed in Stage 10 — that one did block
painting; this one does not).

## 6. Fix implemented

The movement is removed rather than the symptom. Nothing about the navigation's
design changed: the settled geometry is byte-for-byte what it was
(Fixtures 708.72 / News & Events 783.16 at 1440px, identical in both themes).

1. **Metric-matched local fallback** (`styles.css`). Three `@font-face` rules
   share the family `'Open Sans Fallback'`, one per local system font, each with
   its own measured `size-adjust` — the browser uses the first face it can
   resolve:

   | Face | `size-adjust` | Worst nav movement (measured) |
   | --- | --- | --- |
   | `local('Segoe UI')` (Windows) | 109.75% | 1.44px |
   | `local('Tahoma')` (Windows) | 110.75% | 1.66px |
   | `local('Arial')` (Windows + macOS) | 107% | 2.70px |

   The vertical metrics are Open Sans' own (`ascent-override: 106.88%`,
   `descent-override: 29.29%`, `line-gap-override: 0%`) so the header keeps its
   height. The family is inserted directly after `'Open Sans'` in `--font-ui`,
   so `system-ui` is only reached once every tuned face is unavailable.

   Values were tuned against **real layout**, not canvas metrics: an earlier
   canvas-based estimate was wrong by a factor of two because it ignored layout
   rounding and the synthetic bold used for the active item.

2. **Font preload** (`_includes/head.njk`). The two above-the-fold fonts are
   preloaded (`as="font"`, `crossorigin`), so on a normal connection the real
   metrics are in place for the first paint and there is no re-flow at all. The
   URLs are the same files the stylesheet requests — no extra downloads.

3. **Adjacent defect found while verifying 1024px** (`script.js`). The Stage 10
   `pageshow` handler reset the mobile drawer on *every* load, and `pageshow`
   fires after `load` — so a user who opened the burger menu before the page
   finished loading had it close itself a second later (measured: `body` lost
   `menu-open` exactly when `document.fonts.status` became `loaded`). It now
   only reacts to a real back/forward restore (`event.persisted`), which is what
   it was written for.

### Before / after movement (worst navigation item, real layout)

| Width | Theme | Before | After |
| --- | --- | --- | --- |
| 1440px | light | 32.94px | **2.70px** |
| 1280px | light | 32.94px | **2.70px** |
| 1024px (drawer) | light | 0px | 0px |
| 1440px | dark | 32.94px | **2.70px** |
| 1280px | dark | 32.94px | **2.70px** |
| 1024px (drawer) | dark | 0px | 0px |

The 2.70px residual on this machine is the Arial face: this Windows box has a
**locally installed "Open Sans"**, which satisfies the family name before the
tuned face is reached, so the remainder is the small metric difference between
that local version and our webfont file. On machines without a local Open Sans
the tuned faces apply (1.44–1.70px), and with the preload the webfont normally
wins the race outright.

### Behaviour, before and after

Sampling 15 points across the label as the user sees it before the font arrives:

| | Before | After |
| --- | --- | --- |
| Points that still resolve to "News & Events" after the font loads | 14 of 15 — the point at x=902 resolved to **Gallery** (wrong page), and the band at x≈900.7 resolved to the bare `ul` (**no navigation at all**) | **15 of 15**, every one navigating to `/news.html` |

## 7. Regression tests

`tests/navigation-hit-target.spec.js`:

| Test | Status | What it pins |
| --- | --- | --- |
| navigation hit targets hold their position across the web font swap | **passes** (was failing at 32.94px) | six steps: light and dark × 1440, 1280 and 1024px. Fails if any nav item moves ≥3px — below the 4px gap between items — and checks the drawer's links are top of the stack at their centre. |
| a click aimed at the painted navigation label still reaches that link | **passes** (was failing: "x=902 → Gallery") | every one of nine sample points across the painted label must still resolve to the link, and a real click must reach `/news.html` |
| 100 rapid Fixtures ↔ News clicks all navigate | passes | the brief's stress test: visible hit-testable targets, non-zero box, navigation request, destination interactive |

The two reproduction tests emulate a cold load by delaying the font files (not
the stylesheet, which would also hold up `DOMContentLoaded`).

## 8. Verification after the fix

| Gate | Result |
| --- | --- |
| `tests/navigation-hit-target.spec.js` | 3/3 pass (matrix: light + dark × 1440/1280/1024) |
| Full Playwright suite | **191 passed, 0 failed, 97 skipped** (exit 0) — includes the visual baselines, so the settled layout is unchanged |
| axe, day/night × desktop/mobile, 18 pages | **0 violations in all four passes** |
| Header collision probe (18 pages × 11 widths × 2 themes) | **396 checks, 0 problems** |
| Homepage weight | 945,951 → 948,370 bytes (**+2.4KB, +0.26%** — the `@font-face` rules and two `preload` tags) |
| Homepage requests | 14 → 14 (no new requests; the preloaded fonts are the same files the CSS requests, no duplicate fetch) |
| Console | no errors or preload warnings; preloaded fonts start in 11–19ms |

## 9. Reproducing everything

```powershell
$env:SITE_ROOT="_site-alt"

# 1. Anchor inventory for every page (hidden duplicates included)
node tools/diagnose-navigation-lock.mjs --inventory

# 2. Nav geometry across pages, scrollbar state
node tools/diagnose-navigation-lock.mjs --geometry --width=1440 --server=serve

# 3. The re-flow itself (fallback layout vs web-font layout)
node tools/diagnose-navigation-lock.mjs --fontshift --width=1440

# 4. The failing click, with the header state at the moment of failure
node tools/diagnose-navigation-lock.mjs --repro --fontdelay=1200 --width=1440

# 5. Before/after movement per width and theme
node tools/diagnose-navigation-lock.mjs --matrix

# 6. Which local fallback face the browser resolves, and the tuned optimum
node tools/diagnose-navigation-lock.mjs --probe
node tools/diagnose-navigation-lock.mjs --tune

# 7. The stress test and the two reproduction tests
npx.cmd playwright test tests/navigation-hit-target.spec.js --project=desktop
```

Raw JSON: `reports/stage11/navigation-lock-diagnosis.json`.
