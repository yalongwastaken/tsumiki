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

test("appendTx appends optimistically; a failure re-syncs and reports an error", async () => {
  const { api, calls } = makeApi({
    addTransaction: async () => {
      throw new Error("offline");
    },
  });
  const { store, changes, events } = makeStore(api);
  store.setCommitted({ rev: 1, transactions: [] });

  await store.appendTx({ id: "t1", type: "spending", amount: 5 });

  assert.equal(calls.getState.length, 1); // re-synced (entry didn't persist)
  assert.equal(changes.at(-1).transactions[0].id, "server");
  assert.deepEqual(events.at(-1), ["error", "offline"]);
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

test("setCommitted merges the empty shape so missing keys get safe defaults", () => {
  const { api } = makeApi();
  const { store } = makeStore(api);
  const s = store.setCommitted({ rev: 3 });
  assert.deepEqual(s.transactions, []);
  assert.deepEqual(s.accounts, []);
  assert.equal(store.getRev(), 3);
});
