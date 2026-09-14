import {
  ROLE_WIDTHS,
  imageAttributes,
  imageGraphic,
  imageOriginal,
  imageSize,
  imageSrcset,
  imageUrl,
} from "./tools/image-pipeline.mjs";

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
  eleventyConfig.addPassthroughCopy("README.md");
  eleventyConfig.ignores.add("_site/**");
  eleventyConfig.ignores.add("node_modules/**");
  eleventyConfig.ignores.add("playwright-report/**");
  eleventyConfig.ignores.add("reports/**");
  eleventyConfig.ignores.add("test-results/**");
  eleventyConfig.ignores.add("tests/**");
  eleventyConfig.ignores.add("tools/**");

  // Image filters. Originals stay in Images/ as the club archive; templates
  // reference build-time derivatives that the pipeline writes into _site.
  eleventyConfig.addFilter("imageUrl", imageUrl);
  eleventyConfig.addFilter("imageSrcset", imageSrcset);
  eleventyConfig.addFilter("imageOriginal", imageOriginal);
  eleventyConfig.addFilter("imageGraphic", imageGraphic);
  eleventyConfig.addFilter("imageSize", imageSize);
  eleventyConfig.addFilter("imageAttributes", imageAttributes);
  eleventyConfig.addGlobalData("imageWidths", ROLE_WIDTHS);

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
      output: "_site",
    },
    htmlTemplateEngine: "njk",
    templateFormats: ["html"],
    pathPrefix: "/",
  };
}
