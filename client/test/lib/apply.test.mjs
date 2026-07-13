// apply.test.mjs — the "I moved it" plan→ledger gaps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contributionGaps, gapsTotal } from "../../src/lib/plan/apply.js";

test("gaps are target minus already-logged actual, per bucket", () => {
  const gaps = contributionGaps(
    { emergency: 500, retirement: 800, invest: 700, debt: 300 },
    { emergency: 500, retirement: 300, invest: 0, debt: 0 },
  );
  assert.deepEqual(gaps, [
    { bucket: "retirement", amount: 500 },
    { bucket: "invest", amount: 700 },
    { bucket: "debt", amount: 300 },
  ]);
  assert.equal(gapsTotal(gaps), 1500);
});

test("over-contributed buckets and empty targets produce no gaps", () => {
  assert.deepEqual(contributionGaps({ invest: 500 }, { invest: 900 }), []);
  assert.deepEqual(contributionGaps({}, {}), []);
});

test("amounts round to whole dollars and ignore garbage", () => {
  const gaps = contributionGaps({ invest: 499.6, emergency: "abc" }, {});
  assert.deepEqual(gaps, [{ bucket: "invest", amount: 500 }]);
});
