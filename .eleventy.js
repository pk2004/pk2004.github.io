const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { default: Image, generateHTML } = require("@11ty/eleventy-img");
const pluginRss = require("@11ty/eleventy-plugin-rss");
const TurndownService = require("turndown");
const site = require("./src/_data/site.json");

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
  // Product shots and app icons ("fit": "contain") sit on the tile's white
  // background: flatten any transparency onto white (so the JPEG fallback
  // isn't black), then trim the empty space so each fills its tile evenly.
  const input = item.fit === "contain"
    ? await sharp(src).flatten({ background: "#ffffff" }).trim({ background: "#ffffff", threshold: 10 }).toBuffer()
    : src;
  const metadata = await Image(input, {
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

// Renders a company logo from src/img/logos/ for the Work page timeline, or
// the company's letter mark until a logo is added.
async function companyLogo(job) {
  const src = job.logo && `src/img/logos/${job.logo}`;
  if (!src || !fs.existsSync(src)) {
    return `<span class="career-mark" aria-hidden="true">${job.mark}</span>`;
  }
  // Flatten transparency onto white and trim empty space, as for gear images.
  const input = await sharp(src).flatten({ background: "#ffffff" }).trim({ background: "#ffffff", threshold: 10 }).toBuffer();
  const metadata = await Image(input, {
    widths: [96, 192],
    formats: ["avif", "webp", "png"],
    outputDir: "docs/img/logos/",
    urlPath: "/img/logos/",
  });
  return generateHTML(metadata, {
    alt: `${job.company} logo`,
    sizes: "48px",
    loading: "lazy",
    decoding: "async",
  });
}

// Link log helpers.
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const readableDate = (date) => `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
const monthYear = (date) => date.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const domain = (url) => new URL(url).hostname.replace(/^www\./, "");

// Groups links (newest first) into [{ month, links }] for the Links page.
function groupByMonth(links) {
  const groups = [];
  for (const link of links) {
    const month = monthYear(link.date);
    if (!groups.length || groups[groups.length - 1].month !== month) groups.push({ month, links: [] });
    groups[groups.length - 1].links.push(link);
  }
  return groups;
}

// Markdown versions of every page: /work/ is also served as /work.md and the
// homepage as /index.md.
const markdownUrl = (url) => (url === "/" ? "/index.md" : `${url.replace(/\/$/, "")}.md`);

const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
turndown.remove(["script", "style"]);
const text = (node, selector) => (node.querySelector(selector)?.textContent || "").trim();
// Icons become their <title> text, so an icon-only link reads "[LinkedIn](...)".
turndown.addRule("svg", {
  filter: "svg",
  replacement: (content, node) => text(node, "title").replace(/ icon$/i, ""),
});
// A career timeline role on one line: "- **Title**, Company (dates). Note".
turndown.addRule("careerRole", {
  filter: (node) => node.nodeName === "LI" && node.classList.contains("career-role"),
  replacement: (content, node) => {
    const note = text(node, ".career-note");
    return `- **${text(node, ".career-title")}**, ${text(node, ".career-company")} (${text(node, ".career-years")})${note ? `. ${note}` : ""}\n`;
  },
});
// A link log entry: the link, its site and date, then the commentary.
turndown.addRule("linklogItem", {
  filter: (node) => node.nodeName === "LI" && node.classList.contains("linklog-item"),
  replacement: (content, node) => {
    const a = node.querySelector(".linklog-title a");
    const meta = [text(node, ".linklog-domain"), text(node, ".linklog-date")].filter(Boolean).join(", ");
    const note = turndown.turndown(node.querySelector(".linklog-note")?.innerHTML || "").replace(/\n/g, "\n  ");
    return `- [${a.textContent.trim()}](${a.getAttribute("href")}) (${meta})\n\n  ${note}\n\n`;
  },
});

// After each build, convert the <main> content of every HTML page to
// Markdown, and write the Netlify headers that serve it as text/markdown
// plus an llms.txt index of the Markdown pages.
function writeMarkdownVersions(outputDir, results) {
  const pages = [];
  for (const { url, content, outputPath } of results) {
    if (!outputPath || !outputPath.endsWith(".html")) continue;
    const main = content.match(/<main[^>]*>([\s\S]*)<\/main>/);
    if (!main) continue;
    const title = (content.match(/<title>([^<]*)<\/title>/) || [])[1] || site.title;
    const body = turndown.turndown(main[1])
      .replace(/\]\(\//g, `](${site.url}/`)
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const mdUrl = markdownUrl(url);
    const frontMatter = `---\ntitle: ${JSON.stringify(title)}\nurl: ${site.url}${url}\n---\n\n`;
    fs.writeFileSync(path.join(outputDir, mdUrl), `${frontMatter}${body}\n`);
    pages.push({ url, mdUrl, title });
  }
  pages.sort((a, b) => a.url.localeCompare(b.url));

  const headers = pages.map((p) => `${p.mdUrl}\n  Content-Type: text/markdown; charset=utf-8\n`);
  headers.push("/links/feed.xml\n  Content-Type: application/rss+xml; charset=utf-8\n");
  headers.push("/llms.txt\n  Content-Type: text/plain; charset=utf-8\n");
  fs.writeFileSync(path.join(outputDir, "_headers"), headers.join("\n"));

  const name = (p) => p.url === "/" ? "Home"
    : p.title === site.title ? p.url.replace(/\//g, "").replace(/^./, (c) => c.toUpperCase())
    : p.title.replace(`${site.title} - `, "");
  const index = pages.map((p) => `- [${name(p)}](${site.url}${p.mdUrl})`);
  fs.writeFileSync(path.join(outputDir, "llms.txt"),
    `# ${site.title}\n\n> Personal site of Paul Kane, Director of Technology at ITV in London.\n\n` +
    `Every page is also available as Markdown by adding .md to its URL.\n\n## Pages\n\n${index.join("\n")}\n`);
}

module.exports = function (eleventyConfig) {
    eleventyConfig.addPassthroughCopy("src/img");
    eleventyConfig.addPassthroughCopy("src/favicon.svg");
    eleventyConfig.addPassthroughCopy("src/favicon.ico");
    eleventyConfig.addPassthroughCopy("src/apple-touch-icon.png");
    eleventyConfig.addPassthroughCopy("src/_redirects");
    eleventyConfig.addAsyncShortcode("gallery", gallery);
    eleventyConfig.addAsyncShortcode("gearImage", gearImage);
    eleventyConfig.addAsyncShortcode("companyLogo", companyLogo);

    eleventyConfig.addPlugin(pluginRss);
    eleventyConfig.addCollection("linksNewest", (api) => api.getFilteredByTag("links").reverse());
    eleventyConfig.addFilter("readableDate", readableDate);
    eleventyConfig.addFilter("domain", domain);
    eleventyConfig.addFilter("groupByMonth", groupByMonth);
    eleventyConfig.addFilter("markdownUrl", markdownUrl);
    eleventyConfig.on("eleventy.after", ({ directories, results }) => writeMarkdownVersions(directories.output, results));

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
