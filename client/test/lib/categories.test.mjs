// categories.test.mjs — canonical list, merchant auto-categorization, merge helper.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, categorize, allCategories } from "../../src/lib/core/categories.js";

test("categorize maps merchants to canonical categories", () => {
  assert.equal(categorize("NETFLIX.COM"), "Subscriptions");
  assert.equal(categorize("Uber trip 1234"), "Transport");
  assert.equal(categorize("WHOLE FOODS MKT"), "Groceries");
  assert.equal(categorize("Starbucks #123"), "Dining Out");
  assert.equal(categorize("AMAZON MKTPL"), "Shopping");
  assert.equal(categorize("some random merchant"), null); // unknown → caller decides
  assert.equal(categorize(""), null);
});

test("categorize disambiguates Uber rides from Uber Eats", () => {
  assert.equal(categorize("UBER TRIP 8AM"), "Transport");
  assert.equal(categorize("Uber Eats order"), "Dining Out"); // food, not a ride
  assert.equal(categorize("Amazon Prime Video"), "Subscriptions"); // not Shopping
  assert.equal(categorize("AMAZON.COM purchase"), "Shopping");
});

test("categorize only returns categories from the canonical list", () => {
  for (const note of ["netflix", "uber", "costco", "cvs pharmacy", "delta air"]) {
    const c = categorize(note);
    assert.ok(c === null || CATEGORIES.includes(c), `${note} → ${c}`);
  }
});

test("allCategories surfaces used categories first, then the rest of the defaults", () => {
  const tx = [
    { type: "spending", amount: 10, cat: "Dining Out", date: "2026-06-01" },
    { type: "spending", amount: 10, cat: "Dining Out", date: "2026-06-02" },
    { type: "spending", amount: 10, cat: "Custom Cat", date: "2026-06-03" }, // user free-text
    { type: "income", amount: 999, date: "2026-06-01" }, // ignored
  ];
  const list = allCategories(tx);
  assert.equal(list[0], "Dining Out"); // most-used first
  assert.ok(list.includes("Custom Cat")); // user categories preserved
  assert.ok(list.includes("Groceries")); // defaults still present
  // no duplicates
  assert.equal(new Set(list).size, list.length);
});
