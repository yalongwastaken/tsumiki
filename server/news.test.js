// news.test.js — RSS/Atom parsing (the only non-trivial, pure part of news.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed } from "./news.js";

test("parses RSS items with CDATA + entities", () => {
  const xml = `<rss><channel>
    <item><title><![CDATA[Save more & spend less]]></title>
      <link>https://ex.com/a</link><pubDate>Mon, 01 Jun 2026 10:00:00 GMT</pubDate></item>
    <item><title>Rates rose 0.5%</title><link>https://ex.com/b</link></item>
  </channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Save more & spend less"); // CDATA + &amp; decoded
  assert.equal(items[0].link, "https://ex.com/a");
  assert.match(items[0].date, /Jun 2026/);
  assert.equal(items[1].link, "https://ex.com/b");
});

test("parses Atom entries with href links", () => {
  const xml = `<feed>
    <entry><title type="html">Budgeting 101</title>
      <link href="https://ex.com/x" rel="alternate"/><updated>2026-06-01T10:00:00Z</updated></entry>
  </feed>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Budgeting 101");
  assert.equal(items[0].link, "https://ex.com/x");
});

test("ignores items without a title and tolerates junk", () => {
  assert.deepEqual(parseFeed(""), []);
  assert.deepEqual(parseFeed("<rss><channel><item><link>x</link></item></channel></rss>"), []);
});
