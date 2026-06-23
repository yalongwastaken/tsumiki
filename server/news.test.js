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
  assert.deepEqual(parseFeed("not xml at all"), []);
  assert.deepEqual(parseFeed("<rss><channel></channel></rss>"), []);
});

test("decodes numeric + hex + nbsp entities, strips inline tags", () => {
  const xml = `<rss><channel>
    <item><title>Fed&#8217;s rate&#x20;cut&nbsp;looms</title><link>https://e.com/1</link></item>
    <item><title>Stocks &lt;b&gt;up&lt;/b&gt; &amp; bonds</title><link>https://e.com/2</link></item>
    <item><title>Plain &#38; simple</title><link>https://e.com/3</link></item>
  </channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items[0].title, "Fed’s rate cut looms"); // &#8217; = curly ’, hex space, nbsp
  assert.equal(items[1].title, "Stocks <b>up</b> & bonds"); // entity-encoded markup preserved as text
  assert.equal(items[2].title, "Plain & simple"); // &#38; → &
});

test("preserves item order and caps nothing at the parse layer", () => {
  const items = Array.from({ length: 12 }, (_, i) => `<item><title>H${i}</title></item>`).join("");
  const out = parseFeed(`<rss><channel>${items}</channel></rss>`);
  assert.equal(out.length, 12); // parse returns all; refreshNews caps to MAX_ITEMS
  assert.equal(out[0].title, "H0");
  assert.equal(out[11].title, "H11");
});

test("falls back across pubDate / updated / published for the date", () => {
  const rss = parseFeed(
    `<rss><channel><item><title>A</title><pubDate>Tue, 02 Jun 2026 00:00:00 GMT</pubDate></item></channel></rss>`,
  );
  assert.match(rss[0].date, /Jun 2026/);
  const atom = parseFeed(
    `<feed><entry><title>B</title><published>2026-06-02T00:00:00Z</published></entry></feed>`,
  );
  assert.equal(atom[0].date, "2026-06-02T00:00:00Z");
});

test("Atom: picks the href when <link> has no text node", () => {
  const xml = `<feed><entry><title>X</title>
    <link href="https://e.com/x" rel="alternate"/></entry></feed>`;
  assert.equal(parseFeed(xml)[0].link, "https://e.com/x");
});

test("decodes entity-encoded hrefs and prefers the Atom alternate link", () => {
  const xml = `<feed><entry><title>X</title>
    <link href="https://e.com/feed" rel="self"/>
    <link href="https://e.com/a?x=1&amp;y=2" rel="alternate"/>
  </entry></feed>`;
  const items = parseFeed(xml);
  assert.equal(items[0].link, "https://e.com/a?x=1&y=2"); // &amp; decoded, self skipped
});

test("accepts single-quoted hrefs", () => {
  const xml = `<feed><entry><title>Y</title><link href='https://e.com/y'/></entry></feed>`;
  assert.equal(parseFeed(xml)[0].link, "https://e.com/y");
});

test("de-duplicates repeated entries by link", () => {
  const xml = `<rss><channel>
    <item><title>A</title><link>https://e.com/a</link></item>
    <item><title>A (dupe)</title><link>https://e.com/a</link></item>
    <item><title>B</title><link>https://e.com/b</link></item>
  </channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((i) => i.link),
    ["https://e.com/a", "https://e.com/b"],
  );
});

test("drops non-http(s) links (javascript:/data: from a hostile feed)", () => {
  const xml = `<rss><channel>
    <item><title>A</title><link>javascript:fetch('/api/reset',{method:'POST'})</link></item>
    <item><title>B</title><link>data:text/html,<script>1</script></link></item>
    <item><title>C</title><link>  HTTPS://ex.com/ok  </link></item>
  </channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items[0].link, ""); // javascript: scrubbed
  assert.equal(items[1].link, ""); // data: scrubbed
  assert.equal(items[2].link, "HTTPS://ex.com/ok"); // trimmed, scheme allowed
});
