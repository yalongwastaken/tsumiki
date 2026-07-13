// persist.js — the client's persistence machinery, extracted from App.jsx so the
// riskiest code in the client (optimistic writes, the serialized save chain, and
// 409 rebase/re-sync) is pure and unit-testable.
//
// Model: every write is applied optimistically to a synchronous mirror of the latest
// committed state, then queued on a promise chain so rapid saves can't self-conflict.
// Functional updaters are applied to the MIRROR (not a render closure), so a write
// queued behind another — or fired from an effect with intentionally-narrow deps —
// rebases onto the latest state instead of persisting a stale snapshot. On any write
// failure the store re-syncs from the server rather than leaving stale optimistic UI.

/**
 * Create the persistence store.
 *
 * @param {Object} opts
 * @param {Object} opts.api - injected fetch layer (so this module has no import.meta
 *   dependency and tests can stub the network):
 *   `{ putState, patchState, addTransaction, getState }`
 * @param {Object} opts.empty - the EMPTY state shape; committed states are merged
 *   over it so missing keys always have safe defaults
 * @param {(state: Object) => void} opts.onChange - called with every state change
 *   (optimistic applies and committed re-syncs) — wire to React's setState
 * @param {() => void} [opts.onSaved] - a queued write persisted (show "Saved")
 * @param {(info: {conflict: boolean, message: string}) => void} [opts.onResync] -
 *   a write failed and the store re-synced from the server; `conflict` is true for
 *   a 409 (changed elsewhere — not an error), false for a real failure
 * @param {(message: string) => void} [opts.onError] - unrecoverable: the write
 *   failed AND the re-sync failed (for the full-state path), or a lean append
 *   failed (re-synced silently, but the entry was lost)
 */
export function createPersistence({
  api,
  empty,
  onChange,
  onSaved = () => {},
  onResync = () => {},
  onError = () => {},
}) {
  let rev = 0; // last server rev (optimistic concurrency)
  let current = empty; // synchronous mirror of the latest state
  let chain = Promise.resolve(); // serialize writes so rapid saves can't self-conflict

  /** The latest state (optimistic). Reads here instead of a render closure never go stale. */
  const snapshot = () => current;
  const getRev = () => rev;
  /** Await all queued writes (tests + "are we synced?" checks). */
  const flush = () => chain;

  /** Adopt a server-fresh state as committed truth (boot load, unlock, reset, re-sync). */
  function setCommitted(fresh) {
    rev = fresh.rev ?? 0;
    current = { ...empty, ...fresh };
    onChange(current);
    return current;
  }

  // apply a functional updater (or constant) to the mirror + notify the UI
  function apply(produce) {
    current = typeof produce === "function" ? produce(current) : produce;
    onChange(current);
    return current;
  }

  // queue a rev-checked write; on failure re-sync from the server. The rev is read at
  // EXECUTION time (not enqueue time) so a write queued behind another uses the rev
  // its predecessor just advanced to.
  function enqueue(write) {
    chain = chain.then(async () => {
      try {
        const saved = await write(rev);
        rev = saved.rev ?? rev;
        onSaved();
      } catch (e) {
        // 409 = changed elsewhere; any other failure means the write didn't persist.
        // Either way, re-sync rather than leave stale optimistic UI.
        try {
          setCommitted(await api.getState());
          onResync({ conflict: e.status === 409, message: String(e.message || e) });
        } catch {
          onError(String(e.message || e));
        }
      }
    });
    return chain;
  }

  /**
   * Full-state save (rewrites the normalized tables) — account/snapshot/debt edits.
   * Accepts a functional updater `(d) => next` (preferred) or a constant next state.
   */
  function save(produce) {
    const next = apply(produce);
    return enqueue((r) => api.putState({ ...next, rev: r }));
  }

  /**
   * Granular save of only the profile/settings/holdings blobs — frequent toggles
   * (theme, blur, goals, strategy…) that shouldn't rewrite the whole ledger.
   * Accepts a partial object or a `(d) => partial` updater; the partial is computed
   * from — and merged onto — the latest state.
   */
  function saveMeta(partial) {
    const part = typeof partial === "function" ? partial(current) : partial;
    apply((d) => ({ ...d, ...part }));
    return enqueue((r) => api.patchState({ ...part, rev: r }));
  }

  /**
   * Lean transaction append — the common no-balance-move log. Optimistic append,
   * then POST /api/transactions (no rev clash by design). On failure: re-sync
   * (so the UI is truthful) and report via onError — the entry did not persist.
   */
  function appendTx(tx) {
    apply((d) => ({ ...d, transactions: [...d.transactions, tx] }));
    chain = chain.then(async () => {
      try {
        const saved = await api.addTransaction(tx);
        rev = saved.rev ?? rev;
        onSaved();
      } catch (e) {
        try {
          setCommitted(await api.getState());
        } catch {
          /* keep optimistic UI if even the re-sync failed; the error below still shows */
        }
        onError(String(e.message || e));
      }
    });
    return chain;
  }

  return { save, saveMeta, appendTx, setCommitted, snapshot, getRev, flush };
}
