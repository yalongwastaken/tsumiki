// components.test.mjs — render-level tests for key components (server-render to
// markup, so no jsdom/act needed). Run via: node --import ./test/component/register.mjs
// --test test/component/*.test.mjs  (the JSX loader handles .jsx imports).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import NetWorthCard from "../../src/NetWorthCard.jsx";
import AreaChart from "../../src/Chart.jsx";
import MoneyTargets from "../../src/MoneyTargets.jsx";
import QuickAdd from "../../src/QuickAdd.jsx";
import Portfolio, { syncProblem } from "../../src/Portfolio.jsx";
import StocksSankey from "../../src/StocksSankey.jsx";
import Money, { BlurAmounts } from "../../src/Money.jsx";

const html = (el) => renderToStaticMarkup(el);

test("NetWorthCard renders the starting-point prompt + placeholder", () => {
  const out = html(h(NetWorthCard, { realNetWorth: 1234, onSet() {} }));
  assert.match(out, /Starting point/);
  assert.match(out, /1234/); // rounded placeholder
});

test("AreaChart renders an accessible SVG with a value range", () => {
  const data = [
    { x: "a", y: 100 },
    { x: "b", y: 250 },
    { x: "c", y: 180 },
  ];
  const out = html(h(AreaChart, { data, xKey: "x", yKey: "y", label: "Net worth" }));
  assert.match(out, /<svg/);
  assert.match(out, /role="img"/);
  assert.match(out, /aria-label="Net worth/);
});

test("MoneyTargets shows goal progress + on-track pace", () => {
  const targets = [{ id: "g", label: "Vacation", amount: 6000, metric: "net_worth" }];
  const out = html(h(MoneyTargets, { targets, values: { net_worth: 3000 }, monthlyPace: 500 }));
  assert.match(out, /Vacation/);
  assert.match(out, /\$3,000/); // current value
  assert.match(out, /\$6,000/); // target
});

test("QuickAdd (open) renders the amount field + type toggle", () => {
  const out = html(
    h(QuickAdd, { open: true, onClose() {}, onLog() {}, cats: ["Dining Out"], transactions: [] }),
  );
  assert.match(out, /aria-label="Amount"/);
  assert.match(out, /Spending/);
  assert.match(out, /Dining Out/);
});

test("QuickAdd (closed) renders nothing", () => {
  const out = html(
    h(QuickAdd, { open: false, onClose() {}, onLog() {}, cats: [], transactions: [] }),
  );
  assert.equal(out, "");
});

test("Portfolio empty state prompts to add holdings", () => {
  const out = html(h(Portfolio, { holdings: [], prices: null }));
  assert.match(out, /Track individual stocks/);
});

test("StocksSankey renders total, account buckets, and ticker labels", () => {
  const rows = [
    { id: "1", ticker: "AAPL", account: "taxable", value: 2000 },
    { id: "2", ticker: "VTI", account: "taxable", value: 1000 },
    { id: "3", ticker: "VOO", account: "roth", value: 2500 },
  ];
  const out = html(h(StocksSankey, { rows }));
  assert.match(out, /<svg/);
  assert.match(out, /role="img"/);
  assert.match(out, /Portfolio/); // total node label
  assert.match(out, /Taxable/); // bucket label
  assert.match(out, /Roth/);
  assert.match(out, /AAPL/); // a ticker
  assert.match(out, /VOO/);
  // aria-label summarizes the separation
  assert.match(out, /separated into/);
});

test("Money renders a blurrable .money span with the formatted amount", () => {
  const out = html(h(Money, { n: 1234 }));
  assert.match(out, /class="money"/); // the class CSS blurs in privacy mode
  assert.match(out, /\$1,234/);
  // compact form + an extra class merge
  const k = html(h(Money, { n: 1500, k: true, className: "font-mono" }));
  assert.match(k, /class="money font-mono"/);
  assert.match(k, /\$1\.5k/);
});

test("BlurAmounts wraps $ amounts in a string but leaves the rest plain", () => {
  const out = html(h(BlurAmounts, { text: "$10,000 net worth milestone" }));
  assert.match(out, /<span class="money">\$10,000<\/span>/);
  assert.match(out, /net worth milestone/);
  // a string with no amount renders unchanged (no money span)
  assert.equal(html(h(BlurAmounts, { text: "First investment" })), "First investment");
  // handles a negative amount mid-sentence
  assert.match(html(h(BlurAmounts, { text: "$-80 — over budget" })), /class="money">\$-80</);
});

test("StocksSankey amount labels carry the .money class (blurrable)", () => {
  const rows = [
    { id: "1", ticker: "AAPL", account: "taxable", value: 2000 },
    { id: "2", ticker: "VOO", account: "roth", value: 2500 },
  ];
  const out = html(h(StocksSankey, { rows }));
  assert.match(out, /class="money"/); // total + ticker value <text> are blurrable
});

test("StocksSankey renders nothing with fewer than two priced holdings", () => {
  assert.equal(html(h(StocksSankey, { rows: [] })), "");
  assert.equal(
    html(h(StocksSankey, { rows: [{ id: "1", ticker: "AAPL", account: "taxable", value: 2000 }] })),
    "",
  );
});

test("syncProblem: clean statuses + missing payloads return null", () => {
  for (const status of ["ok", "idle", "disabled"]) {
    assert.equal(syncProblem({ status, missing: [] }), null);
  }
  assert.equal(syncProblem(null), null); // older payload with no lastSync
  assert.equal(syncProblem(undefined), null);
  assert.equal(syncProblem({ status: "weird-future-status" }), null); // fail safe
});

test("syncProblem: error/empty are assertive (alert tone), partial is a warning", () => {
  assert.equal(syncProblem({ status: "error" }).tone, "error");
  assert.equal(syncProblem({ status: "empty" }).tone, "error");
  assert.equal(syncProblem({ status: "partial", missing: ["MSFT"] }).tone, "warn");
});

test("syncProblem: partial names the missing tickers, caps a long list, pluralizes", () => {
  const one = syncProblem({ status: "partial", missing: ["MSFT"] });
  assert.match(one.text, /No fresh price for MSFT/);
  assert.match(one.text, /last saved value\./); // singular

  const many = syncProblem({
    status: "partial",
    missing: ["A", "B", "C", "D", "E", "F"],
  });
  assert.match(many.text, /A, B, C, D \+2 more/); // capped at 4 + "+N more"
  assert.match(many.text, /last saved values\./); // plural

  // tolerates an undefined missing array without throwing
  assert.doesNotThrow(() => syncProblem({ status: "partial" }));
});

test("Portfolio shows a failure note + 'last good sync' wording, not a fresh-sync claim", () => {
  const out = html(
    h(Portfolio, {
      holdings: [{ id: "h1", ticker: "AAPL", shares: 10, account: "taxable" }],
      prices: {
        enabled: true,
        prices: { AAPL: { price: 100, date: "2026-06-20", changePct: null } },
        fetchedAt: Date.now() - 2 * 3.6e6, // 2h-old last-good data
        history: [],
        lastSync: { status: "error", at: Date.now(), source: null, missing: ["AAPL"] },
      },
    }),
  );
  assert.match(out, /couldn&#x27;t reach the feed/); // the amber note
  assert.match(out, /role="alert"/); // error is announced assertively
  assert.match(out, /last good sync/); // footer doesn't claim a fresh sync
  assert.doesNotMatch(out, /Prices synced 2h ago/); // ...the contradictory wording is gone
});

test("Portfolio idle (enabled, never synced) invites a first sync rather than 'off'", () => {
  const out = html(
    h(Portfolio, {
      holdings: [{ id: "h1", ticker: "AAPL", shares: 10, account: "taxable" }],
      prices: {
        enabled: true,
        prices: {},
        fetchedAt: null,
        history: [],
        lastSync: { status: "idle", at: 0, source: null, missing: [] },
      },
      onSync() {},
    }),
  );
  assert.match(out, /haven&#x27;t synced yet/);
  assert.doesNotMatch(out, /off by default/);
});
