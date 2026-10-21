import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import handler from "../netlify/functions/add-link.mjs";
import { emailAddress, linkFile, parseEmail, sameSecret, slugify, stripEmailNoise } from "../netlify/lib/links.mjs";

const gmail = (plain, subject = "", from = "Paul Kane <pk2004@gmail.com>") => ({
  envelope: { from: emailAddress(from), to: "abc@cloudmailin.net", spf: { result: "pass", domain: "gmail.com" } },
  headers: { from, subject, to: "abc@cloudmailin.net" },
  plain,
});

describe("parseEmail", () => {
  test("takes the URL from the first line and the rest as commentary", () => {
    const link = parseEmail(gmail("https://example.com/post\n\nA great read on caching.\nWorth it.", "Caching done right"));
    assert.deepEqual(link, { url: "https://example.com/post", title: "Caching done right", commentary: "A great read on caching.\nWorth it." });
  });

  test("keeps a sentence that contains the URL, trimming the URL's trailing punctuation", () => {
    const link = parseEmail(gmail("Have a look at https://example.com/a?b=1. Lovely stuff."));
    assert.equal(link.url, "https://example.com/a?b=1");
    assert.equal(link.commentary, "Have a look at https://example.com/a?b=1. Lovely stuff.");
  });

  test("uses a URL in the subject when the body has none, with no title", () => {
    const link = parseEmail(gmail("Thoughts here.", "https://example.com/x"));
    assert.deepEqual(link, { url: "https://example.com/x", title: "", commentary: "Thoughts here." });
  });

  test("strips Fwd: and Re: from the subject", () => {
    assert.equal(parseEmail(gmail("https://example.com", "Fwd: Re: Good article")).title, "Good article");
  });

  test("returns null with no URL", () => {
    assert.equal(parseEmail(gmail("No link here", "Hello")), null);
  });
});

test("stripEmailNoise drops signatures, quotes and mobile footers", () => {
  const text = "Keep this\n> quoted\n\nSent from my iPhone\nnot this";
  assert.equal(stripEmailNoise(text), "Keep this");
  assert.equal(stripEmailNoise("Keep\n-- \nSignature"), "Keep");
  assert.equal(stripEmailNoise("Keep\r\nOn Mon, 1 Jan 2026, Paul wrote:\n> old"), "Keep");
});

test("emailAddress reads names, bare addresses and arrays", () => {
  assert.equal(emailAddress("Paul Kane <PK2004@gmail.com>"), "pk2004@gmail.com");
  assert.equal(emailAddress(["pk2004@gmail.com"]), "pk2004@gmail.com");
  assert.equal(emailAddress(undefined), "");
});

test("slugify makes short, safe file names", () => {
  assert.equal(slugify("Café: The *Best* Article — Ever!"), "cafe-the-best-article-ever");
  assert.equal(slugify("!!!"), "link");
  assert.ok(slugify("a".repeat(100)).length <= 60);
});

test("linkFile writes front matter that survives quotes and colons", () => {
  const file = linkFile({ title: 'He said "hi": ok', url: "https://e.com/a:b", commentary: "Nice.", date: new Date("2026-10-21T08:00:00Z") });
  assert.equal(file, '---\ntitle: "He said \\"hi\\": ok"\nurl: "https://e.com/a:b"\ndate: 2026-10-21T08:00:00.000Z\n---\nNice.\n');
});

test("sameSecret compares exactly", () => {
  assert.ok(sameSecret("abc123", "abc123"));
  assert.ok(!sameSecret("abc124", "abc123"));
  assert.ok(!sameSecret(null, "abc123"));
});

describe("add-link function", () => {
  const realFetch = globalThis.fetch;
  let calls;

  beforeEach(() => {
    Object.assign(process.env, { LINKS_SECRET: "s3cret-key", ALLOWED_SENDER: "pk2004@gmail.com", GITHUB_TOKEN: "ghp_test" });
    calls = [];
    // Fake GitHub: the first file name is taken, the second is free. Fake
    // article page for the title lookup.
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).startsWith("https://api.github.com/")) {
        if (init.method === "PUT") return new Response("{}", { status: 201 });
        return new Response("{}", { status: String(url).endsWith("-2.md") ? 404 : 200 });
      }
      return new Response('<html><head><title>Fetched &amp; Titled</title></head></html>');
    };
  });

  afterEach(() => { globalThis.fetch = realFetch; });

  const post = (body, key = "s3cret-key") => handler(new Request(`https://paulkane.co/api/add-link?key=${key}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));

  test("commits a new link, avoiding a taken file name", async () => {
    const response = await post(gmail("https://example.com/post\n\nWorth reading.", "A good post"));
    assert.equal(response.status, 201);
    const put = calls.find((c) => c.init.method === "PUT");
    assert.match(put.url, /contents\/src\/links\/\d{4}-\d{2}-\d{2}-a-good-post-2\.md$/);
    const body = JSON.parse(put.init.body);
    assert.equal(body.message, "Add link: A good post");
    const file = Buffer.from(body.content, "base64").toString();
    assert.match(file, /^---\ntitle: "A good post"\nurl: "https:\/\/example.com\/post"\ndate: .+\n---\nWorth reading.\n$/);
    assert.equal(put.init.headers.Authorization, "Bearer ghp_test");
  });

  test("fetches the page title when the subject is empty", async () => {
    await post(gmail("https://example.com/post"));
    const put = calls.find((c) => c.init.method === "PUT");
    assert.match(Buffer.from(JSON.parse(put.init.body).content, "base64").toString(), /title: "Fetched & Titled"/);
  });

  test("rejects a wrong key", async () => {
    assert.equal((await post(gmail("https://example.com"), "nope")).status, 403);
    assert.equal(calls.length, 0);
  });

  test("rejects other senders and failed SPF", async () => {
    assert.equal((await post(gmail("https://example.com", "", "someone@else.com"))).status, 403);
    const spoofed = gmail("https://example.com");
    spoofed.envelope.spf.result = "fail";
    assert.equal((await post(spoofed)).status, 403);
    assert.equal(calls.length, 0);
  });

  test("explains when there's no link", async () => {
    const response = await post(gmail("Just words", "Hello"));
    assert.equal(response.status, 422);
    assert.match(await response.text(), /No link found/);
  });
});
