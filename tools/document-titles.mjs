/**
 * Stage 13 — <title> wording.
 *
 * Headlines are written for readers, not for browser tabs: several news
 * headlines are long enough that "headline - Polmaise Bowling Club" pushes the
 * document title past the 70 characters html-validate allows (and past what
 * search results display). The visible headline is never changed — only the
 * machine-facing <title> is shortened, at a word boundary.
 *
 * The length is measured on the *escaped* text, because that is what the
 * validator sees: an apostrophe costs five characters once it is written as
 * `&#39;` and a quote costs six.
 */
export const SITE_TITLE_SUFFIX = "Polmaise Bowling Club";

export const TITLE_LIMIT = 70;

const ESCAPES = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&#39;"],
]);

/** Mirrors the escaping Nunjucks applies to an interpolated value. */
export function escapeTitleText(value) {
  return String(value).replace(/[&<>"']/g, (character) => ESCAPES.get(character));
}

const renderedLength = (value) => escapeTitleText(value).length;

function truncateAtWordBoundary(value, limit) {
  const words = value.split(/\s+/);

  while (words.length > 1) {
    words.pop();
    const candidate = `${words.join(" ")}…`;
    if (renderedLength(candidate) <= limit) return candidate;
  }

  let clipped = words[0] ?? "";
  while (clipped.length > 1 && renderedLength(`${clipped}…`) > limit) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped.trimEnd()}…`;
}

/**
 * Keeps a document title inside the length budget. Long titles lose their
 * " - Polmaise Bowling Club" suffix first (the site name is already in the
 * Open Graph data and the header), and only then get trimmed with an ellipsis.
 */
export function trimDocumentTitle(value, limit = TITLE_LIMIT) {
  const title = String(value ?? "").trim();
  if (renderedLength(title) <= limit) return title;

  const suffixMatch = title.match(/^(.{20,}?)\s+[-–—]\s+[^-–—]+$/);
  if (suffixMatch && renderedLength(suffixMatch[1]) <= limit) {
    return suffixMatch[1].trim();
  }

  return truncateAtWordBoundary(title, limit);
}

/** The article-page title: headline first, site name when it fits. */
export function newsPageTitle(title, siteName = SITE_TITLE_SUFFIX, limit = TITLE_LIMIT) {
  return trimDocumentTitle(`${String(title ?? "").trim()} - ${siteName}`, limit);
}
