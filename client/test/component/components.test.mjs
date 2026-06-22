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
import Portfolio from "../../src/Portfolio.jsx";

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
