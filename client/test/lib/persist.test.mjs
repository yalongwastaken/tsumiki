// persist.test.mjs — lock in the persistence machinery extracted from App.jsx:
// optimistic writes, the serialized save chain, rev advancement, and 409/failure
// re-sync. This was the riskiest untested code in the client (AUDIT test-gap item).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPersistence } from "../../src/lib/core/persist.js";

const EMPTY = { transactions: [], accounts: [], profile: {}, settings: {} };

// tiny stub api: every method records its calls; behavior injectable per test
function makeApi(overrides = {}) {
  const calls = { putState: [], patchState: [], addTransaction: [], getState: [] };
  const api = {
    putState: async (body) => {
      calls.putState.push(body);
      return { rev: (body.rev ?? 0) + 1 };
    },
    patchState: async (body) => {
      calls.patchState.push(body);
      return { rev: (body.rev ?? 0) + 1 };
    },
    addTransaction: async (tx) => {
      calls.addTransaction.push(tx);
      return { rev: 99 };
    },
    getState: async () => {
      calls.getState.push(true);
      return { rev: 42, transactions: [{ id: "server" }] };
    },
    ...overrides,
  };
  return { api, calls };
}

function makeStore(api, hooks = {}) {
  const changes = [];
  const events = [];
  const store = createPersistence({
    api,
    empty: EMPTY,
    onChange: (s) => changes.push(s),
    onSaved: () => events.push("saved"),
    onResync: (info) => events.push(["resync", info]),
    onError: (msg) => events.push(["error", msg]),
    ...hooks,
  });
  return { store, changes, events };
}

test("save applies optimistically, sends the rev, and advances it from the response", async () => {
  const { api, calls } = makeApi();
  const { store, changes, events } = makeStore(api);
  store.setCommitted({ rev: 5, transactions: [] });

  await store.save((d) => ({ ...d, accounts: [{ id: "a" }] }));

  assert.equal(changes.at(-1).accounts[0].id, "a"); // optimistic UI updated
  assert.equal(calls.putState[0].rev, 5); // write carried the base rev
  assert.equal(store.getRev(), 6); // rev advanced from the response
  assert.deepEqual(events, ["saved"]);
});

test("queued saves rebase on the latest state and use the freshly-advanced rev", async () => {
  const { api, calls } = makeApi();
  const { store } = makeStore(api);
  store.setCommitted({ rev: 1, transactions: [] });

  // two rapid saves — the second's functional updater must see the first's result,
  // and its write must carry the rev the first advanced to (2), not the stale 1
  store.save((d) => ({ ...d, accounts: [{ id: "a" }] }));
  store.save((d) => ({ ...d, accounts: [...(d.accounts || []), { id: "b" }] }));
  await store.flush();

  assert.equal(calls.putState.length, 2);
  assert.deepEqual(
    calls.putState[1].accounts.map((x) => x.id),
    ["a", "b"], // rebased, not overwritten from a stale closure
  );
  assert.equal(calls.putState[0].rev, 1);
  assert.equal(calls.putState[1].rev, 2);
  assert.equal(store.getRev(), 3);
});

test("a 409 re-syncs from the server and reports a conflict (not an error)", async () => {
  const conflict = Object.assign(new Error("rev mismatch"), { status: 409 });
  const { api, calls } = makeApi({
    putState: async () => {
      throw conflict;
    },
  });
  const { store, changes, events } = makeStore(api);
  store.setCommitted({ rev: 1, transactions: [] });

  await store.save((d) => ({ ...d, accounts: [{ id: "a" }] }));

  assert.equal(calls.getState.length, 1); // re-synced
  assert.equal(store.getRev(), 42); // adopted the fresh rev
  assert.equal(changes.at(-1).transactions[0].id, "server"); // optimistic state replaced
  assert.equal(changes.at(-1).accounts.length, 0); // EMPTY defaults merged in
  const [tag, info] = events.at(-1);
  assert.equal(tag, "resync");
  assert.equal(info.conflict, true);
});

test("a non-409 failure re-syncs and reports conflict:false with the message", async () => {
  const { api } = makeApi({
    putState: async () => {
      throw Object.assign(new Error("boom"), { status: 500 });
    },
  });
  const { store, events } = makeStore(api);
  store.setCommitted({ rev: 1 });

  await store.save((d) => d);

  const [tag, info] = events.at(-1);
  assert.equal(tag, "resync");
  assert.equal(info.conflict, false);
  assert.match(info.message, /boom/);
});

test("when the write AND the re-sync both fail, onError fires with the write's message", async () => {
  const { api } = makeApi({
    putState: async () => {
      throw new Error("write down");
    },
    getState: async () => {
      throw new Error("sync down");
    },
  });
  const { store, events } = makeStore(api);
  store.setCommitted({ rev: 1 });

  await store.save((d) => d);

  assert.deepEqual(events.at(-1), ["error", "write down"]);
});

test("saveMeta merges the partial into local state but sends ONLY the partial + rev", async () => {
  const { api, calls } = makeApi();
  const { store, changes } = makeStore(api);
  store.setCommitted({ rev: 7, transactions: [{ id: "t1" }], settings: { theme: "light" } });

  await store.saveMeta((d) => ({ settings: { ...d.settings, theme: "dark" } }));

  assert.equal(changes.at(-1).settings.theme, "dark"); // merged locally
  assert.equal(changes.at(-1).transactions[0].id, "t1"); // ledger untouched
  const sent = calls.patchState[0];
  assert.deepEqual(Object.keys(sent).sort(), ["rev", "settings"]); // lean payload
  assert.equal(sent.rev, 7);
});

test("appendTx failure with the server REACHABLE re-syncs and reports via onResync", async () => {
  // a 400-class rejection while online is a real failure, not "offline" — the
  // caller must not show an offline banner for it (audit C-M5)
  const { api, calls } = makeApi({
    addTransaction: async () => {
      throw Object.assign(new Error("bad tx"), { status: 400 });
    },
  });
  const { store, changes, events } = makeStore(api);
  store.setCommitted({ rev: 1, transactions: [] });

  await store.appendTx({ id: "t1", type: "spending", amount: 5 });

  assert.equal(calls.getState.length, 1); // re-synced (entry didn't persist)
  assert.equal(changes.at(-1).transactions[0].id, "server");
  const [tag, info] = events.at(-1);
  assert.equal(tag, "resync"); // NOT "error" — the server answered
  assert.equal(info.conflict, false);
});

test("appendTx failure with the server UNREACHABLE keeps optimistic UI + onError", async () => {
  const { api } = makeApi({
    addTransaction: async () => {
      throw new Error("offline");
    },
    getState: async () => {
      throw new Error("offline");
    },
  });
  const { store, changes, events } = makeStore(api);
  store.setCommitted({ rev: 1, transactions: [] });

  await store.appendTx({ id: "t1", type: "spending", amount: 5 });

  assert.equal(changes.at(-1).transactions[0].id, "t1"); // optimistic entry survives
  assert.deepEqual(events.at(-1), ["error", "offline"]); // caller may go offline-mode
});

test("appendTx success advances the rev and a queued full save composes on the new tx", async () => {
  const { api, calls } = makeApi();
  const { store } = makeStore(api);
  store.setCommitted({ rev: 1, transactions: [] });

  store.appendTx({ id: "t1", type: "spending", amount: 5 });
  store.save((d) => ({ ...d, profile: { name: "A" } })); // queued behind the append
  await store.flush();

  assert.equal(store.snapshot().transactions.length, 1);
  assert.equal(calls.putState[0].transactions[0].id, "t1"); // the save carried the tx
  assert.equal(calls.putState[0].rev, 99); // and the rev the append advanced to
});

test("saveEntity upserts locally and PATCHes only that item + rev", async () => {
  const calls = [];
  const { api } = makeApi({
    patchEntity: async (kind, item) => {
      calls.push([kind, item]);
      return { rev: (item.rev ?? 0) + 1 };
    },
  });
  const { store, changes } = makeStore(api);
  store.setCommitted({ rev: 3, debts: [{ id: "d1", name: "Card", balance: 500 }] });

  await store.saveEntity("debts", { id: "d1", name: "Card", balance: 400 });
  assert.equal(changes.at(-1).debts[0].balance, 400); // updated in place
  await store.saveEntity("debts", { id: "d2", name: "Loan", balance: 900 });
  assert.equal(changes.at(-1).debts.length, 2); // appended

  assert.deepEqual(calls[0][0], "debts");
  assert.equal(calls[0][1].rev, 3); // carried the base rev
  assert.equal(calls[1][1].rev, 4); // and the advanced one
  assert.equal(store.getRev(), 5);
});

test("deleteEntity('accounts') drops snapshots locally and patches orphaned holdings", async () => {
  const deleted = [];
  const patched = [];
  const { api } = makeApi({
    deleteEntity: async (kind, id, rev) => {
      deleted.push([kind, id, rev]);
      return { rev: rev + 1 };
    },
    patchState: async (body) => {
      patched.push(body);
      return { rev: (body.rev ?? 0) + 1 };
    },
  });
  const { store, changes } = makeStore(api);
  store.setCommitted({
    rev: 1,
    accounts: [{ id: "a1" }, { id: "a2" }],
    snapshots: [
      { id: "s1", accountId: "a1" },
      { id: "s2", accountId: "a2" },
    ],
    holdings: [
      { id: "h1", accountId: "a1", ticker: "VTSAX", shares: 1 },
      { id: "h2", accountId: "a2", ticker: "AAPL", shares: 1 },
    ],
  });

  await store.deleteEntity("accounts", "a1");

  const s = changes.at(-1);
  assert.deepEqual(
    s.accounts.map((a) => a.id),
    ["a2"],
  );
  assert.deepEqual(
    s.snapshots.map((x) => x.id),
    ["s2"],
  ); // cascaded locally
  assert.deepEqual(
    s.holdings.map((h) => h.id),
    ["h2"],
  ); // orphaned holding dropped
  assert.deepEqual(deleted, [["accounts", "a1", 1]]);
  assert.equal(patched.length, 1); // follow-up holdings patch queued
  assert.deepEqual(
    patched[0].holdings.map((h) => h.id),
    ["h2"],
  );
  assert.equal(patched[0].rev, 2); // used the rev the DELETE advanced to
});

test("mid-chain 409: later queued saves persist the RESYNCED truth, not stale payloads", async () => {
  // first save conflicts; the resync brings server state. The second queued save
  // must then send what the UI shows (resynced state) instead of resurrecting the
  // conflicted content — otherwise UI and server silently diverge.
  let putCount = 0;
  const puts = [];
  const { api } = makeApi({
    putState: async (body) => {
      puts.push(body);
      putCount++;
      if (putCount === 1) {
        throw Object.assign(new Error("rev mismatch"), { status: 409 });
      }
      return { rev: (body.rev ?? 0) + 1 };
    },
    getState: async () => ({ rev: 42, transactions: [{ id: "server" }], accounts: [] }),
  });
  const { store, changes } = makeStore(api);
  store.setCommitted({ rev: 1, transactions: [], accounts: [] });

  store.save((d) => ({ ...d, accounts: [{ id: "a" }] })); // will 409
  store.save((d) => ({ ...d, accounts: [...d.accounts, { id: "b" }] })); // queued behind it
  await store.flush();

  // the second PUT carried the post-resync ledger, not the pre-conflict accounts
  const second = puts[1];
  assert.equal(second.rev, 42);
  assert.deepEqual(
    second.transactions.map((t) => t.id),
    ["server"],
  );
  // and the UI mirror matches what was persisted (no divergence)
  assert.deepEqual(
    changes.at(-1).transactions.map((t) => t.id),
    ["server"],
  );
});

test("saveEntity voids itself when a mid-chain resync removed the item", async () => {
  let patched = 0;
  const { api } = makeApi({
    putState: async () => {
      throw Object.assign(new Error("rev mismatch"), { status: 409 });
    },
    patchEntity: async () => {
      patched++;
      return { rev: 43 };
    },
    getState: async () => ({ rev: 42, debts: [] }), // resync: the debt is GONE server-side
  });
  const { store } = makeStore(api);
  store.setCommitted({ rev: 1, debts: [] });

  store.save((d) => d); // 409s → resync wipes the optimistic debt below
  store.saveEntity("debts", { id: "d1", name: "Card", balance: 100 });
  await store.flush();

  assert.equal(patched, 0); // the upsert was voided, not resurrected
  assert.equal(store.getRev(), 42);
});

test("a failed/conflicted account DELETE never fires the holdings patch", async () => {
  let patchStateCalls = 0;
  const { api } = makeApi({
    deleteEntity: async () => {
      throw Object.assign(new Error("rev mismatch"), { status: 409 });
    },
    patchState: async () => {
      patchStateCalls++;
      return { rev: 99 };
    },
    getState: async () => ({
      rev: 42,
      accounts: [{ id: "a1" }],
      snapshots: [{ id: "s1", accountId: "a1" }],
      holdings: [{ id: "h1", accountId: "a1", ticker: "VTSAX", shares: 1 }],
    }),
  });
  const { store, changes } = makeStore(api);
  store.setCommitted({
    rev: 1,
    accounts: [{ id: "a1" }],
    snapshots: [{ id: "s1", accountId: "a1" }],
    holdings: [{ id: "h1", accountId: "a1", ticker: "VTSAX", shares: 1 }],
  });

  await store.deleteEntity("accounts", "a1"); // DELETE 409s → resync restores it

  assert.equal(patchStateCalls, 0); // the still-existing account keeps its holdings
  assert.deepEqual(
    changes.at(-1).holdings.map((h) => h.id),
    ["h1"],
  ); // UI restored too
});

test("setCommitted merges the empty shape so missing keys get safe defaults", () => {
  const { api } = makeApi();
  const { store } = makeStore(api);
  const s = store.setCommitted({ rev: 3 });
  assert.deepEqual(s.transactions, []);
  assert.deepEqual(s.accounts, []);
  assert.equal(store.getRev(), 3);
});
