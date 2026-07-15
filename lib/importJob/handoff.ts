// Owner-stamped, versioned, tab-scoped sessionStorage handoff between the import
// page and the Post Job wizard (plan D3/D5).
//
// Rules enforced here:
// - Authentication readiness precedes ownership validation: readers take the
//   RESOLVED owner ("anon" only after the session resolved as unauthenticated) and
//   are never invoked while the session is loading. Deferral never purges.
// - Owner mismatch or stale/malformed payloads purge the key and read as absent.
// - The consumed marker is owner-stamped too, so a hard remount after a persona
//   switch can't inherit another user's "already consumed" state.

import type { ImportHandoffPayloadV1 } from "./types.ts";

export const IMPORT_SOURCE_KEY = "creatorjobs:jobImport:source:v1";
export const IMPORT_HANDOFF_KEY = "creatorjobs:jobImport:handoff:v1";
export const IMPORT_CONSUMED_KEY = "creatorjobs:jobImport:consumed:v1";

/** Payloads older than this are treated as expired. */
export const IMPORT_HANDOFF_MAX_AGE_MS = 30 * 60 * 1000;

export const ANON_OWNER = "anon";

export type ImportSourcePayloadV1 = {
  version: 1;
  createdAt: number;
  owner: string;
  text: string;
};

type ConsumedMarkerV1 = { at: number; owner: string };

// ---------------------------------------------------------------------------
// Pure codecs (unit-tested without a browser)
// ---------------------------------------------------------------------------

export function encodeImportHandoff(payload: ImportHandoffPayloadV1): string {
  return JSON.stringify(payload);
}

export function decodeImportHandoff(
  raw: string | null | undefined,
  resolvedOwner: string,
  now: number = Date.now()
): ImportHandoffPayloadV1 | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ImportHandoffPayloadV1;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.version !== 1) return null;
    if (typeof parsed.createdAt !== "number" || now - parsed.createdAt > IMPORT_HANDOFF_MAX_AGE_MS) return null;
    if (typeof parsed.owner !== "string" || parsed.owner !== resolvedOwner) return null;
    if (!parsed.prefill || typeof parsed.prefill !== "object") return null;
    if (!parsed.meta || typeof parsed.meta !== "object") return null;
    if (typeof parsed.initialStep !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function encodeImportSource(payload: ImportSourcePayloadV1): string {
  return JSON.stringify(payload);
}

export function decodeImportSource(
  raw: string | null | undefined,
  resolvedOwner: string,
  now: number = Date.now()
): ImportSourcePayloadV1 | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ImportSourcePayloadV1;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.version !== 1) return null;
    if (typeof parsed.createdAt !== "number" || now - parsed.createdAt > IMPORT_HANDOFF_MAX_AGE_MS) return null;
    if (typeof parsed.owner !== "string" || parsed.owner !== resolvedOwner) return null;
    if (typeof parsed.text !== "string" || !parsed.text) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Browser wrappers (all storage failures degrade to "absent")
// ---------------------------------------------------------------------------

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function writeImportHandoff(payload: ImportHandoffPayloadV1): void {
  try {
    storage()?.setItem(IMPORT_HANDOFF_KEY, encodeImportHandoff(payload));
  } catch {
    // Private-mode/quota failures degrade gracefully; the wizard shows the
    // expired-session notice.
  }
}

/**
 * Read + validate the handoff for the RESOLVED owner. Invalid/stale/foreign
 * payloads are purged and read as absent. Never call with an unresolved session.
 */
export function readImportHandoff(resolvedOwner: string): ImportHandoffPayloadV1 | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(IMPORT_HANDOFF_KEY);
    if (raw === null) return null;
    const payload = decodeImportHandoff(raw, resolvedOwner);
    if (!payload) store.removeItem(IMPORT_HANDOFF_KEY);
    return payload;
  } catch {
    return null;
  }
}

export function clearImportHandoff(): void {
  try {
    storage()?.removeItem(IMPORT_HANDOFF_KEY);
  } catch {
    // ignore
  }
}

export function writeImportSource(text: string, resolvedOwner: string): void {
  try {
    storage()?.setItem(
      IMPORT_SOURCE_KEY,
      encodeImportSource({ version: 1, createdAt: Date.now(), owner: resolvedOwner, text })
    );
  } catch {
    // ignore
  }
}

export function readImportSource(resolvedOwner: string): string | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(IMPORT_SOURCE_KEY);
    if (raw === null) return null;
    const payload = decodeImportSource(raw, resolvedOwner);
    if (!payload) {
      store.removeItem(IMPORT_SOURCE_KEY);
      return null;
    }
    return payload.text;
  } catch {
    return null;
  }
}

export function clearImportSource(): void {
  try {
    storage()?.removeItem(IMPORT_SOURCE_KEY);
  } catch {
    // ignore
  }
}

export function markImportConsumed(resolvedOwner: string): void {
  try {
    const marker: ConsumedMarkerV1 = { at: Date.now(), owner: resolvedOwner };
    storage()?.setItem(IMPORT_CONSUMED_KEY, JSON.stringify(marker));
  } catch {
    // ignore
  }
}

/**
 * True when THIS resolved owner consumed a handoff recently (hard-remount case).
 * Stale or foreign-owner markers are purged and read as false.
 */
export function hasRecentImportConsumption(resolvedOwner: string, now: number = Date.now()): boolean {
  const store = storage();
  if (!store) return false;
  try {
    const raw = store.getItem(IMPORT_CONSUMED_KEY);
    if (raw === null) return false;
    const marker = JSON.parse(raw) as ConsumedMarkerV1;
    const valid =
      marker &&
      typeof marker === "object" &&
      typeof marker.at === "number" &&
      typeof marker.owner === "string" &&
      now - marker.at <= IMPORT_HANDOFF_MAX_AGE_MS &&
      marker.owner === resolvedOwner;
    if (!valid) store.removeItem(IMPORT_CONSUMED_KEY);
    return Boolean(valid);
  } catch {
    return false;
  }
}
