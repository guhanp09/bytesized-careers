// Per-user scoping for client-persisted workspace state (inbox mode/view,
// selected thread, chat dock, private-note cache). These live in localStorage,
// which is shared across sessions in the same browser — switching QA personas
// (or signing into a different account) must never restore another user's
// state. Every persisted key is therefore suffixed with the backend user id, so
// each account keeps its own state and switching back restores the right one.

/** Storage key scoped to the signed-in backend user (or "local" when absent). */
export function userStorageKey(base: string, ownerId?: string | null): string {
  const owner = (ownerId || "").trim() || "local";
  return `${base}::${owner}`;
}

/**
 * Remove a legacy, un-scoped key left behind by earlier builds so stale state
 * written before per-user scoping can never leak into any account's session.
 */
export function purgeLegacyStorageKey(base: string): void {
  try {
    window.localStorage.removeItem(base);
  } catch {
    // Storage can be unavailable (private mode); nothing to purge then.
  }
}
