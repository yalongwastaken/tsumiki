// news.js — OPT-IN money-news headlines. Off unless TSUMIKI_NEWS_FEED is set to
// a public RSS/Atom URL, so a stock install makes zero outbound calls. When on,
// the server fetches the feed (nightly + lazily when stale), caches it in memory,
// and serves headlines only. Awareness-only: it never drives recommendations and
// nothing about you is ever sent anywhere.

import { fetchTextCapped } from "./http.js";

const FEED = process.env.TSUMIKI_NEWS_FEED || "";
const TTL = 20 * 60 * 60 * 1000; // refetch at most ~daily
const MAX_ITEMS = 8;

let cache = { items: [], fetchedAt: 0 };

// safe code-point → string (guards bad/out-of-range numeric entities)
const cp = (n) => {
  try {
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  } catch {
    return "";
  }
};

const decode = (s = "") =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => cp(parseInt(h, 16))) // hex numeric entities
    .replace(/&#(\d+);/g, (_, n) => cp(parseInt(n, 10))) // decimal numeric entities
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&") // ampersand last, so "&amp;lt;" → "&lt;" not "<"
    .replace(/\s+/g, " ")
    .trim();

const tagText = (block, name) => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m ? decode(m[1]) : "";
};

// only let http(s) links through to the client. a compromised/hostile feed could
// otherwise smuggle a `javascript:` (or `data:`) link that runs in the app origin
// on click — drop anything that isn't a normal web URL.
function safeLink(url = "") {
  const u = (url || "").trim();
  return /^https?:\/\//i.test(u) ? u : "";
}

// extract a headline link from an item/entry block. RSS uses <link>url</link>; Atom
// uses one or more <link href="..." rel="..."/> — prefer the alternate (the article)
// and never the self/edit feed links. hrefs may be single- or double-quoted and
// entity-encoded (&amp; in query strings), so decode them.
function pickLink(block) {
  const text = tagText(block, "link"); // RSS text node
  if (text) {
    return text;
  }
  let fallback = "";
  for (const tag of block.match(/<link\b[^>]*>/gi) || []) {
    const href = /href=["']([^"']+)["']/i.exec(tag);
    if (!href) {
      continue;
    }
    const url = decode(href[1]);
    const rel = (/rel=["']([^"']+)["']/i.exec(tag)?.[1] || "").toLowerCase();
    if (rel === "self" || rel === "edit") {
      continue;
    }
    if (rel === "alternate" || rel === "") {
      return url;
    }
    fallback = fallback || url;
  }
  return fallback;
}

/**
 * Parse an RSS or Atom feed into headline items. Pure — no network. De-duplicates
 * by link (then title) so a feed that repeats an entry doesn't show it twice.
 * @returns {Array<{title, link, date}>}
 */
// bound the parse so a hostile/compromised feed can't stall the (single-threaded)
// server: cap how many item blocks we scan and truncate any one giant block. The
// per-tag regexes are linear over a block, so bounding block size bounds total work.
const MAX_BLOCKS = 200;
const MAX_BLOCK_LEN = 16_384;

export function parseFeed(xml = "") {
  const blocks = (xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || []).slice(0, MAX_BLOCKS);
  const out = [];
  const seen = new Set();
  for (const raw of blocks) {
    const b = raw.length > MAX_BLOCK_LEN ? raw.slice(0, MAX_BLOCK_LEN) : raw;
    const title = tagText(b, "title");
    if (!title) {
      continue;
    }
    const link = safeLink(pickLink(b));
    const sig = (link || title).toLowerCase();
    if (seen.has(sig)) {
      continue;
    }
    seen.add(sig);
    const date = tagText(b, "pubDate") || tagText(b, "updated") || tagText(b, "published") || "";
    out.push({ title, link, date });
  }
  return out;
}

/** Whether the news feature is configured. */
export const newsEnabled = () => !!FEED;

/** Fetch + cache the feed; on any failure, keep the last good cache. */
export async function refreshNews() {
  if (!FEED) {
    return cache;
  }
  try {
    const text = await fetchTextCapped(FEED, { maxBytes: 3_000_000 });
    if (text == null) {
      return cache;
    }
    const items = parseFeed(text).slice(0, MAX_ITEMS);
    if (items.length) {
      cache = { items, fetchedAt: Date.now() };
    }
  } catch {
    // offline / timeout / bad feed — serve whatever we had
  }
  return cache;
}

/** Cached headlines, refreshing lazily when stale. */
export async function getNews() {
  if (FEED && Date.now() - cache.fetchedAt > TTL) {
    await refreshNews();
  }
  return { enabled: !!FEED, items: cache.items, fetchedAt: cache.fetchedAt || null };
}

/** Kick off a refresh now + nightly (no-op when the feature is off). */
export function scheduleNews() {
  if (!FEED) {
    return null;
  }
  refreshNews();
  return setInterval(refreshNews, 24 * 60 * 60 * 1000);
}
