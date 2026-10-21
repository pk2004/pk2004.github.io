// Receives emails from CloudMailin and adds each one to the link log.
//
// CloudMailin posts to https://paulkane.co/api/add-link?key=<LINKS_SECRET>.
// The email must come from ALLOWED_SENDER. The new link is committed to
// src/links/ on GitHub, and Netlify rebuilds the site.
//
// Environment variables (set in Netlify):
//   LINKS_SECRET    long random string, also in CloudMailin's target URL
//   ALLOWED_SENDER  the only address links are accepted from
//   GITHUB_TOKEN    fine-grained token with Contents read/write on this repo
//   GITHUB_REPO     optional, defaults to pk2004/pk2004.github.io
import { emailAddress, fetchTitle, linkFile, parseEmail, sameSecret, slugify } from "../lib/links.mjs";

export const config = { path: "/api/add-link" };

// CloudMailin bounces the email on a 4xx and retries on a 5xx.
const reply = (status, message) => new Response(`${message}\n`, { status, headers: { "Content-Type": "text/plain" } });

export default async function handler(request) {
  const { LINKS_SECRET, ALLOWED_SENDER, GITHUB_TOKEN } = process.env;
  const repo = process.env.GITHUB_REPO || "pk2004/pk2004.github.io";
  if (!LINKS_SECRET || !ALLOWED_SENDER || !GITHUB_TOKEN) return reply(500, "Link log isn't configured.");
  if (request.method !== "POST") return reply(405, "Use POST.");
  if (!sameSecret(new URL(request.url).searchParams.get("key"), LINKS_SECRET)) return reply(403, "Wrong key.");

  let email;
  try {
    email = await request.json();
  } catch {
    return reply(400, "Expected CloudMailin's JSON format.");
  }

  // The envelope sender and the From header must both be the allowed address,
  // and the sender's mail server must pass SPF where CloudMailin reports it.
  const allowed = ALLOWED_SENDER.trim().toLowerCase();
  const envelopeFrom = emailAddress(email.envelope?.from);
  const headerFrom = emailAddress(email.headers?.from);
  const spf = email.envelope?.spf?.result;
  if (envelopeFrom !== allowed || headerFrom !== allowed || (spf && spf !== "pass")) {
    return reply(403, "Links are only accepted from the site owner.");
  }

  const link = parseEmail(email);
  if (!link) return reply(422, "No link found. Put the URL on the first line of the email.");
  const title = link.title || (await fetchTitle(link.url)) || new URL(link.url).hostname;

  const date = new Date();
  const base = `src/links/${date.toISOString().slice(0, 10)}-${slugify(title)}`;
  const github = (path, init = {}) => fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "paulkane.co link log",
    },
  });

  // Pick a file name that isn't taken yet: name.md, then name-2.md, and so on.
  let path = `${base}.md`;
  for (let n = 2; (await github(path)).status === 200; n++) path = `${base}-${n}.md`;

  const response = await github(path, {
    method: "PUT",
    body: JSON.stringify({
      message: `Add link: ${title}`,
      content: Buffer.from(linkFile({ ...link, title, date })).toString("base64"),
    }),
  });
  if (!response.ok) {
    console.error("GitHub commit failed", response.status, await response.text());
    return reply(502, "Couldn't save the link to GitHub.");
  }
  return reply(201, `Added ${path}`);
}
