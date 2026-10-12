const fs = require("fs");
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

// Renders a gear item's photo from src/img/gear/, or an icon placeholder
// until a photo is added.
async function gearImage(item, iconPath) {
  const src = item.image && `src/img/gear/${item.image}`;
  if (!src || !fs.existsSync(src)) {
    return `<svg class="gear-placeholder" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">` +
      `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="${iconPath}" /></svg>`;
  }
  const metadata = await Image(src, {
    widths: [400, 800],
    formats: ["avif", "webp", "jpeg"],
    outputDir: "docs/img/gear/",
    urlPath: "/img/gear/",
  });
  return generateHTML(metadata, {
    alt: item.name,
    sizes: "(min-width: 1024px) 14vw, (min-width: 640px) 30vw, 50vw",
    loading: "lazy",
    decoding: "async",
  });
}

module.exports = function (eleventyConfig) {
    eleventyConfig.addPassthroughCopy("src/img");
    eleventyConfig.addPassthroughCopy("src/favicon.svg");
    eleventyConfig.addPassthroughCopy("src/favicon.ico");
    eleventyConfig.addPassthroughCopy("src/apple-touch-icon.png");
    eleventyConfig.addPassthroughCopy("src/_redirects");
    eleventyConfig.addAsyncShortcode("gallery", gallery);
    eleventyConfig.addAsyncShortcode("gearImage", gearImage);

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
