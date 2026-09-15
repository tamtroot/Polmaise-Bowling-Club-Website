import path from "node:path";

import {
  ROLE_WIDTHS,
  imageAttributes,
  imageGraphic,
  imageOriginal,
  imageSize,
  imageSrcset,
  imageUrl,
} from "./tools/image-pipeline.mjs";
import { formatNewsDate } from "./tools/news-dates.mjs";
import { newsPageTitle, trimDocumentTitle } from "./tools/document-titles.mjs";

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default function configureEleventy(eleventyConfig) {
  eleventyConfig.addPassthroughCopy("styles.css");
  eleventyConfig.addPassthroughCopy("script.js");
  eleventyConfig.addPassthroughCopy("downloads");
  // Self-hosted jQuery, Lightbox2, Font Awesome and web fonts (Stage 10).
  eleventyConfig.addPassthroughCopy("vendor");
  /**
   * Generated output must never be read back as input. `SITE_ROOT` lets a build
   * write outside `_site` (cloud-synced working copies, variant builds for the
   * regression tests), so the whole `_site*` family is ignored: without this a
   * build re-processed every page of the sibling roots it found, which doubled
   * the files written and made builds progressively slower.
   */
  eleventyConfig.ignores.add("_site*/**");
  eleventyConfig.ignores.add("_site*");
  eleventyConfig.ignores.add(".cache*/**");
  eleventyConfig.ignores.add("node_modules/**");
  eleventyConfig.ignores.add("playwright-report/**");
  eleventyConfig.ignores.add("reports/**");
  eleventyConfig.ignores.add("test-results/**");
  eleventyConfig.ignores.add("tests/**");
  eleventyConfig.ignores.add("tools/**");
  // Markdown is now a template format (the news articles in news/**), so the
  // repository's own documentation must be excluded explicitly.
  eleventyConfig.ignores.add("*.md");
  eleventyConfig.ignores.add("docs/**");
  // The photo archive is managed by the image pipeline, which deploys rendered
  // derivatives into _site/Images itself. Ignoring the source tree here keeps
  // the notes that sit beside the photographs (Images/**/Readme.md) from being
  // published as pages now that markdown is a template format.
  eleventyConfig.ignores.add("Images/**");

  // Image filters. Originals stay in Images/ as the club archive; templates
  // reference build-time derivatives that the pipeline writes into _site.
  eleventyConfig.addFilter("imageUrl", imageUrl);
  eleventyConfig.addFilter("imageSrcset", imageSrcset);
  eleventyConfig.addFilter("imageOriginal", imageOriginal);
  eleventyConfig.addFilter("imageGraphic", imageGraphic);
  eleventyConfig.addFilter("imageSize", imageSize);
  eleventyConfig.addFilter("imageAttributes", imageAttributes);
  eleventyConfig.addGlobalData("imageWidths", ROLE_WIDTHS);

  /**
   * Stage 16: the footer's copyright year comes from the build rather than a
   * literal, so a January rebuild never ships a stale year.
   */
  eleventyConfig.addGlobalData("buildYear", () => new Date().getFullYear());

  // Stage 13: the one human-readable date style used by the news landing page,
  // the year/category archives, the historical archive and every article page.
  eleventyConfig.addFilter("newsDate", formatNewsDate);

  // Article headlines stay verbatim on the page; the document title is trimmed
  // to a search-result friendly length (see tools/document-titles.mjs).
  eleventyConfig.addFilter("newsPageTitle", newsPageTitle);
  eleventyConfig.addFilter("documentTitle", trimDocumentTitle);

  /**
   * Indentation that Nunjucks leaves behind on a line of its own is invisible
   * to readers but shows up as "trailing whitespace" in every HTML validation
   * report (and in diffs). Trailing spaces are insignificant in HTML — the line
   * break after them still collapses to the same single space — so they are
   * removed from the generated markup.
   */
  eleventyConfig.addTransform("trim-trailing-whitespace", function (content) {
    if (!this.page?.outputPath?.endsWith(".html")) return content;
    return content
      .split("\n")
      // The lookahead keeps CRLF output working: without it the carriage
      // return hides the trailing spaces from the pattern.
      .map((line) => line.replace(/[ \t]+(?=\r?$)/, ""))
      .join("\n");
  });

  // The sitemap lists rendered HTML pages only (never the sitemap itself,
  // robots.txt or copied development files). Stage 13's article and archive
  // pages publish directory URLs ("/news/2026/<slug>/"), so anything ending in
  // a slash counts as a page as well as the classic ".html" files.
  eleventyConfig.addFilter("publicPages", (pages) =>
    (pages ?? [])
      .filter(
        (item) =>
          typeof item.url === "string" &&
          (item.url.endsWith(".html") || item.url.endsWith("/")),
      )
      .sort((left, right) => left.url.localeCompare(right.url)),
  );

  // The same helpers are exposed as callable Nunjucks globals so templates can
  // register derivatives for markup that is generated in JavaScript.
  eleventyConfig.addNunjucksGlobal("imageUrl", imageUrl);
  eleventyConfig.addNunjucksGlobal("imageSrcset", imageSrcset);
  eleventyConfig.addNunjucksGlobal("imageOriginal", imageOriginal);
  eleventyConfig.addNunjucksGlobal("imageGraphic", imageGraphic);
  eleventyConfig.addNunjucksGlobal("imageSize", imageSize);

  /**
   * Renders a photographic <img> with build-time derivatives, responsive
   * candidates and intrinsic dimensions.
   *
   * {% photoImage "./Images/club.jpg", "Alt text", { class: "zoomable-image" } %}
   */
  eleventyConfig.addShortcode("photoImage", function photoImage(source, alt, options = {}) {
    const role = options.role ?? "content";
    const widths = ROLE_WIDTHS[role] ?? ROLE_WIDTHS.content;
    const largest = Math.max(...widths);
    const size = imageSize(source, largest);
    const attributes = [
      `src="${escapeAttribute(imageUrl(source, largest))}"`,
      `srcset="${escapeAttribute(imageSrcset(source, widths))}"`,
      options.sizes ? `sizes="${escapeAttribute(options.sizes)}"` : null,
      size.height ? `width="${size.width}" height="${size.height}"` : null,
      `alt="${escapeAttribute(alt)}"`,
      options.class ? `class="${escapeAttribute(options.class)}"` : null,
      options.style ? `style="${escapeAttribute(options.style)}"` : null,
      options.loading === false ? null : `loading="${escapeAttribute(options.loading ?? "lazy")}"`,
      `decoding="async"`,
      ...(options.extraAttributes ?? []),
    ].filter(Boolean);

    return `<img ${attributes.join(" ")}>`;
  });

  /**
   * Renders a resized logo/badge that keeps its original format.
   *
   * {% photoGraphic "./Images/logo.png", "Alt text", { width: 400 } %}
   */
  eleventyConfig.addShortcode("photoGraphic", function photoGraphic(source, alt, options = {}) {
    const width = options.width ?? 400;
    const size = imageSize(source, width);
    const attributes = [
      `src="${escapeAttribute(imageGraphic(source, width))}"`,
      size.height ? `width="${size.width}" height="${size.height}"` : null,
      `alt="${escapeAttribute(alt)}"`,
      options.class ? `class="${escapeAttribute(options.class)}"` : null,
      // Logos are small and their CSS uses `width: auto`, so deferring them
      // would collapse the box until the file arrives.
      options.loading ? `loading="${escapeAttribute(options.loading)}"` : null,
      `decoding="async"`,
    ].filter(Boolean);

    return `<img ${attributes.join(" ")}>`;
  });

  return {
    dir: {
      input: ".",
      // Defaults to _site; SITE_ROOT lets a cloud-synced working copy build
      // somewhere else (see tools/build-site.mjs).
      output: process.env.SITE_ROOT ? path.resolve(process.cwd(), process.env.SITE_ROOT) : "_site",
    },
    htmlTemplateEngine: "njk",
    /**
     * "md" carries the news articles (news/<year>/<slug>.md and
     * news/history/<slug>.md) introduced in Stage 13; "njk" lets sitemap.xml
     * and robots.txt be generated from templates.
     */
    templateFormats: ["html", "njk", "md"],
    markdownTemplateEngine: "njk",
    pathPrefix: "/",
  };
}
