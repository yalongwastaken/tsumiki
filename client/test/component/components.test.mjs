// components.test.mjs — render-level tests for key components (server-render to
// markup, so no jsdom/act needed). Run via: node --import ./test/component/register.mjs
// --test test/component/*.test.mjs  (the JSX loader handles .jsx imports).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import NetWorthCard from "../../src/components/NetWorthCard.jsx";
import AreaChart from "../../src/charts/Chart.jsx";
import MoneyTargets from "../../src/views/MoneyTargets.jsx";
import QuickAdd from "../../src/components/QuickAdd.jsx";
import Portfolio, { syncProblem } from "../../src/views/Portfolio.jsx";
import StocksSankey from "../../src/charts/StocksSankey.jsx";
import SankeyFlow from "../../src/charts/Sankey.jsx";
import Money, { BlurAmounts } from "../../src/components/Money.jsx";
import AccountsSection from "../../src/setup/AccountsSection.jsx";
import Ledger from "../../src/components/Ledger.jsx";
import StreakPanel from "../../src/components/StreakPanel.jsx";
import { netWorthFromSnapshots } from "../../src/lib/core/selectors.js";

// build a streak prop shape (cells unused by these assertions, kept minimal)
const mkStreak = (over = {}) => ({
  current: 0,
  longest: 0,
  freezesUsed: 0,
  loggedToday: false,
  cells: Array.from({ length: 14 }, (_, i) => ({ day: "", met: false, isNow: i === 13 })),
  ...over,
});

test("StreakPanel shows the current tier and progress to the next milestone", () => {
  const out = html(
    h(StreakPanel, {
      streak: mkStreak({ current: 5, longest: 5, loggedToday: true }),
      transactions: [],
    }),
  );
  assert.match(out, /Getting started/); // reached the 3-day tier
  assert.match(out, /2 days to One week/); // 7 − 5
  assert.match(out, /role="progressbar"/);
  assert.match(out, /aria-valuenow="50"/); // (5−3)/(7−3)
  assert.match(out, /Personal best/); // current ties longest, past day 2
});

test("StreakPanel before the first tier aims at it with no tier badge", () => {
  const out = html(h(StreakPanel, { streak: mkStreak({ current: 0 }), transactions: [] }));
  assert.match(out, /3 days to Getting started/);
  assert.doesNotMatch(out, /Personal best/);
});

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

test("AccountsSection shows a credit card as a liability ('owed', in red)", () => {
  const data = {
    accounts: [{ id: "cc", name: "Visa", type: "credit", color: "#94A3B8" }],
    snapshots: [{ id: "s1", accountId: "cc", date: "2026-06-20T12:00:00Z", balance: -1240 }],
    holdings: [],
  };
  const out = html(h(AccountsSection, { data, onSave() {} }));
  assert.match(out, /Credit card/); // type label
  assert.match(out, /owed/);
  assert.match(out, /\$1,240/); // absolute amount, not -$1,240
});

test("a credit card's negative balance subtracts from net worth", () => {
  const snaps = [
    { id: "a", accountId: "chk", date: "2026-06-01", balance: 5000 },
    { id: "b", accountId: "cc", date: "2026-06-01", balance: -1240 }, // owed
  ];
  assert.equal(netWorthFromSnapshots(snaps), 3760); // 5000 − 1240
});

test("Ledger shows an edit button per row when onUpdate is provided", () => {
  const out = html(
    h(Ledger, {
      transactions: [{ id: "s1", type: "spending", amount: 12, date: "2026-06-01", cat: "Food" }],
      sources: [],
      onDelete() {},
      onUpdate() {},
    }),
  );
  assert.match(out, /aria-label="Edit Food"/); // per-row edit affordance
  assert.match(out, /id="tsumiki-ledger-cats"/); // category suggestions always present
});

test("Ledger renders a transfer as 'From → To' with no +/− sign", () => {
  const out = html(
    h(Ledger, {
      transactions: [
        { id: "tr1", type: "transfer", amount: 500, date: "2026-06-01", fromId: "a", toId: "b" },
      ],
      sources: [],
      accounts: [
        { id: "a", name: "Checking", type: "checking" },
        { id: "b", name: "Savings", type: "savings" },
      ],
      onDelete() {},
    }),
  );
  assert.match(out, /Checking → Savings/);
  assert.match(out, /\$500/);
  assert.doesNotMatch(out, /[−+]\s*<span class="money">\$500/); // neutral, no sign
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

test("SankeyFlow coerces a non-finite amount to 0 — never emits NaN in the SVG", () => {
  const today = new Date().toISOString();
  const out = html(
    h(SankeyFlow, {
      transactions: [
        { id: "i", type: "income", amount: Infinity, date: today }, // hostile (e.g. a 1e999 entry)
        { id: "s", type: "spending", amount: 200, cat: "Food", date: today },
      ],
      fallbackIncome: 5000,
    }),
  );
  assert.doesNotMatch(out, /NaN/); // no NaN in viewBox / heights / coords
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
