// Turns an email from CloudMailin (JSON normalized format) into a link log
// entry: a Markdown file in src/links/ with the title, URL and date in its
// front matter and the commentary as its body.

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/i;

// "Paul Kane <pk2004@gmail.com>" -> "pk2004@gmail.com"
export function emailAddress(value) {
  const text = Array.isArray(value) ? value[0] : value || "";
  const match = text.match(/<([^>]+)>/);
  return (match ? match[1] : text).trim().toLowerCase();
}

// Drops quoted replies, signatures and mobile footers from a plain-text body.
export function stripEmailNoise(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const kept = [];
  for (const line of lines) {
    if (line === "-- " || line === "--") break;
    if (/^On .+wrote:\s*$/.test(line)) break;
    if (/^Sent from my /i.test(line.trim())) break;
    if (line.startsWith(">")) continue;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

// Finds the link and commentary: the first URL in the body (or the subject),
// with the rest of the body as commentary and a non-URL subject as the title.
export function parseEmail(email) {
  const headers = email.headers || {};
  const subjectRaw = Array.isArray(headers.subject) ? headers.subject[0] : headers.subject || "";
  const subject = subjectRaw.replace(/^\s*((re|fwd?|fw):\s*)+/i, "").trim();
  const body = stripEmailNoise(email.plain || "");

  const match = (body.match(URL_PATTERN) || subject.match(URL_PATTERN) || [])[0];
  if (!match) return null;
  const url = match.replace(/[.,;:!?]+$/, "");

  // Drop the URL's line when it stands alone; a URL inside a sentence stays.
  const commentary = body
    .split("\n")
    .filter((line) => line.trim() !== url && line.trim() !== match)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const title = URL_PATTERN.test(subject) ? "" : subject;
  return { url, title, commentary };
}

// Reads a page's title, preferring og:title. Returns "" if it can't.
export async function fetchTitle(url, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(url, {
      headers: { "User-Agent": "paulkane.co link log" },
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
    });
    const html = (await response.text()).slice(0, 200000);
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    const title = og ? og[1] : (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1];
    return decodeEntities((title || "").replace(/\s+/g, " ").trim());
  } catch {
    return "";
  }
}

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

export function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "") || "link";
}

// The Markdown file for a link. JSON strings are valid YAML, so titles and
// URLs with quotes or colons can't break the front matter.
export function linkFile({ title, url, commentary, date }) {
  return `---\ntitle: ${JSON.stringify(title)}\nurl: ${JSON.stringify(url)}\ndate: ${date.toISOString()}\n---\n${commentary ? `${commentary}\n` : ""}`;
}

// Constant-time comparison for the shared secret.
export function sameSecret(given, expected) {
  if (!given || !expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
