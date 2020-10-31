module.exports = function (eleventyConfig) {
    eleventyConfig.addPassthroughCopy("src/img");

    return {
      passthroughFileCopy: true,
      dir: {
        input: 'src',
        includes: '_includes',
        data: '_data',
        output: 'docs',
      },
    };
  };