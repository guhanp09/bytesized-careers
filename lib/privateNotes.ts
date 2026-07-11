// Private-note presentation and local cache helpers. In live mode the backend is
// authoritative; localStorage only keeps a fast per-thread cache. Demo mode still
// uses the same helpers as its local source of truth.

export type PrivateNote = {
  id: string;
  body: string;
  /** Display-ready timestamp label (e.g. "Today, 4:20 PM", "2 days ago"). */
  createdAt: string;
  conversationId?: string;
};

import { purgeLegacyStorageKey, userStorageKey } from "./userScopedStorage";

const STORAGE_KEY = "cj.applications.notes";

type NotesMap = Record<string, PrivateNote[]>;

// The cache is keyed per note owner (backend user id): private notes must never
// surface — even transiently, from a stale cache — under another signed-in user
// or QA persona in the same browser.
function readMap(ownerId?: string | null): NotesMap {
  try {
    purgeLegacyStorageKey(STORAGE_KEY);
    const raw = window.localStorage.getItem(userStorageKey(STORAGE_KEY, ownerId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as NotesMap) : {};
  } catch {
    return {};
  }
}

/** Saved notes for a conversation, or null when none were ever stored locally. */
export function loadNotes(ownerId: string | null | undefined, conversationId: string): PrivateNote[] | null {
  const list = readMap(ownerId)[conversationId];
  return Array.isArray(list) ? list : null;
}

export function saveNotes(
  ownerId: string | null | undefined,
  conversationId: string,
  notes: PrivateNote[]
): void {
  try {
    const map = readMap(ownerId);
    map[conversationId] = notes;
    window.localStorage.setItem(userStorageKey(STORAGE_KEY, ownerId), JSON.stringify(map));
  } catch {
    // Storage can be unavailable (private mode); the stack still works in-memory.
  }
}

export function makeNoteId(): string {
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Compact display timestamp for a freshly-created or persisted note. */
export function formatNoteTimestamp(date: Date = new Date()): string {
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return `Today, ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}, ${time}`;
}
