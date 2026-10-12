const { default: Image, generateHTML } = require("@11ty/eleventy-img");

// Builds the photo gallery: resized AVIF/WebP/JPEG versions of each photo,
// linked to the largest JPEG for the PhotoSwipe lightbox.
async function gallery(photos) {
  const figures = await Promise.all(photos.map(async (photo, index) => {
    const metadata = await Image(`src/img/${photo.imgName}`, {
      widths: [480, "auto"],
      formats: ["avif", "webp", "jpeg"],
      outputDir: "docs/img/gallery/",
      urlPath: "/img/gallery/",
    });
    const full = metadata.jpeg[metadata.jpeg.length - 1];
    const picture = generateHTML(metadata, {
      alt: photo.caption,
      sizes: "(min-width: 768px) 30vw, (min-width: 640px) 50vw, 100vw",
      loading: index < 2 ? "eager" : "lazy",
      decoding: "async",
      class: "w-full h-auto rounded-xl",
    });
    return `<figure>` +
      `<a href="${full.url}" data-pswp-width="${full.width}" data-pswp-height="${full.height}" data-cropped="true">${picture}</a>` +
      `<figcaption class="mt-2 text-sm text-gray-600">${photo.caption}</figcaption>` +
      `</figure>`;
  }));
  return `<div id="gallery" class="gallery mt-8">${figures.join("")}</div>`;
}

module.exports = function (eleventyConfig) {
    eleventyConfig.addPassthroughCopy("src/img");
    eleventyConfig.addAsyncShortcode("gallery", gallery);

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
