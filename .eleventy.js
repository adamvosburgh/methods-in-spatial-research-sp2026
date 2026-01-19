const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");
const markdownIt = require("markdown-it");
const markdownItAttrs = require("markdown-it-attrs");

module.exports = function(eleventyConfig) {
  // Path prefix for GitHub Pages deployment
  const pathPrefix = '/methods-in-spatial-research-sp2026';

  // Plugins
  eleventyConfig.addPlugin(syntaxHighlight);

  // Markdown configuration with attributes support (for #img-full, #img-right, etc.)
  const markdownLibrary = markdownIt({
    html: true,
    breaks: false,
    linkify: true
  }).use(markdownItAttrs);
  eleventyConfig.setLibrary("md", markdownLibrary);

  // Copy static assets
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy("src/tutorials/images");
  eleventyConfig.addPassthroughCopy("src/tutorials/data");
  eleventyConfig.addPassthroughCopy("src/assignments/images");
  eleventyConfig.addPassthroughCopy("src/resources/images");

  // Watch targets
  eleventyConfig.addWatchTarget("./src/assets/");

  // Global data
  eleventyConfig.addGlobalData("site", {
    title: "Methods in Spatial Research",
    description: "A4407 Spring 2026 - GSAPP Columbia University"
  });

  eleventyConfig.addGlobalData("environment", {
    baseUrl: pathPrefix
  });

  // Collections for different content types
  eleventyConfig.addCollection("tutorials", function(collectionApi) {
    return collectionApi.getFilteredByGlob("./src/tutorials/*.md")
      .sort((a, b) => {
        return (a.data.sequence || 0) - (b.data.sequence || 0);
      });
  });

  eleventyConfig.addCollection("assignments", function(collectionApi) {
    return collectionApi.getFilteredByGlob("./src/assignments/*.md")
      .sort((a, b) => {
        return (a.data.sequence || 0) - (b.data.sequence || 0);
      });
  });

  eleventyConfig.addCollection("resources", function(collectionApi) {
    return collectionApi.getFilteredByGlob("./src/resources/*.md")
      .filter(item => item.data.cat !== 'syllabus')
      .sort((a, b) => {
        return (a.data.sequence || 0) - (b.data.sequence || 0);
      });
  });

  eleventyConfig.addCollection("syllabus", function(collectionApi) {
    return collectionApi.getFilteredByGlob("./src/resources/*.md")
      .filter(item => item.data.cat === 'syllabus');
  });

  // Filters
  eleventyConfig.addFilter("limit", function(array, limit) {
    return array.slice(0, limit);
  });

  eleventyConfig.addFilter("dateDisplay", function(dateObj) {
    return new Date(dateObj).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  });

  return {
    pathPrefix: pathPrefix,
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      layouts: "_layouts",
      data: "_data"
    },
    templateFormats: ["md", "njk", "html"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk"
  };
};
