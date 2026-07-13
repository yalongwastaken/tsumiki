// fire.test.mjs — lock in the FIRE / projection math moved out of the Fire and
// Projection views (AUDIT test-gap item: view-embedded math was invisible to the
// lib suite).
import { test } from "node:test";
import assert from "node:assert/strict";
import { yearsToTarget, projectSeries } from "../../src/lib/finance/fire.js";

test("yearsToTarget: already at (or past) the target is 0 years", () => {
  assert.equal(yearsToTarget(500_000, 1000, 0.07, 500_000), 0);
  assert.equal(yearsToTarget(600_000, 0, 0.07, 500_000), 0);
});

test("yearsToTarget: contributions alone (0% return) divide out exactly", () => {
  // 100k to go at $1k/mo, no growth → 100 months
  assert.equal(yearsToTarget(0, 1000, 0, 100_000), 100 / 12);
});

test("yearsToTarget: growth accelerates the timeline vs 0%", () => {
  const flat = yearsToTarget(100_000, 2000, 0, 1_000_000);
  const growing = yearsToTarget(100_000, 2000, 0.07, 1_000_000);
  assert.ok(growing < flat, `expected ${growing} < ${flat}`);
  // sanity band: $100k + $2k/mo at 7% reaches $1M in roughly 17-19 years
  assert.ok(growing > 15 && growing < 20, `got ${growing}`);
});

test("yearsToTarget: unreachable at this pace is Infinity (100-year cap)", () => {
  assert.equal(yearsToTarget(0, 0, 0, 1_000_000), Infinity);
  assert.equal(yearsToTarget(0, 1, 0, 10_000_000), Infinity);
});

test("projectSeries: one point per year, starting at the start balance/year", () => {
  const s = projectSeries(10_000, 500, 0.07, 10, 2026);
  assert.equal(s.length, 11); // year 0 through year 10 inclusive
  assert.deepEqual(s[0], { year: 2026, value: 10_000, contributed: 10_000 });
  assert.equal(s.at(-1).year, 2036);
});

test("projectSeries: 0% return means value === contributed all the way", () => {
  const s = projectSeries(1000, 100, 0, 5, 2026);
  for (const p of s) {
    assert.equal(p.value, p.contributed);
  }
  assert.equal(s.at(-1).contributed, 1000 + 100 * 60);
});

test("projectSeries: growth compounds — value pulls ahead of contributed", () => {
  const s = projectSeries(10_000, 500, 0.07, 20, 2026);
  const last = s.at(-1);
  assert.ok(last.value > last.contributed, `${last.value} > ${last.contributed}`);
  // gains should themselves compound: the gap grows year over year
  const gap = (p) => p.value - p.contributed;
  assert.ok(gap(s[10]) > gap(s[5]) && gap(s[5]) > gap(s[1]));
});

test("projectSeries: consistent with yearsToTarget on the same inputs", () => {
  // when yearsToTarget says ~N years, the projection at ceil(N) should be past target
  const years = yearsToTarget(50_000, 1500, 0.07, 300_000);
  const s = projectSeries(50_000, 1500, 0.07, Math.ceil(years), 2026);
  assert.ok(s.at(-1).value >= 300_000);
});
