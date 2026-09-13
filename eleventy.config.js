export default function configureEleventy(eleventyConfig) {
  eleventyConfig.addPassthroughCopy("*.html");
  eleventyConfig.addPassthroughCopy("News articles/*.html");
  eleventyConfig.addPassthroughCopy("PhotoAlbums/*.html");
  eleventyConfig.addPassthroughCopy("styles.css");
  eleventyConfig.addPassthroughCopy("script.js");
  eleventyConfig.addPassthroughCopy("Images");
  eleventyConfig.addPassthroughCopy("downloads");
  eleventyConfig.addPassthroughCopy("README.md");
  eleventyConfig.ignores.add("_site/**");

  return {
    dir: {
      input: ".",
      output: "_site",
    },
    htmlTemplateEngine: false,
    templateFormats: [],
    pathPrefix: "/",
  };
}
