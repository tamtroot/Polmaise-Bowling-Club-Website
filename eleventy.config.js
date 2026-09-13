export default function configureEleventy(eleventyConfig) {
  eleventyConfig.addPassthroughCopy("styles.css");
  eleventyConfig.addPassthroughCopy("script.js");
  eleventyConfig.addPassthroughCopy("Images");
  eleventyConfig.addPassthroughCopy("downloads");
  eleventyConfig.addPassthroughCopy("README.md");
  eleventyConfig.ignores.add("_site/**");
  eleventyConfig.ignores.add("node_modules/**");
  eleventyConfig.ignores.add("playwright-report/**");
  eleventyConfig.ignores.add("reports/**");
  eleventyConfig.ignores.add("test-results/**");
  eleventyConfig.ignores.add("tests/**");
  eleventyConfig.ignores.add("tools/**");

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
