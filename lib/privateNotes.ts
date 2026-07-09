// Local-first private notes for the Applications inbox. Notes are a per-conversation
// stack (newest first) kept in localStorage — there is no multi-note backend, so this
// mirrors how the rest of the workspace persists local UI state (see
// ApplicationsPageClient). The existing single `managerNote` field stays the
// backend-synced "latest note"; this stack is the richer local browsing surface.

export type PrivateNote = {
  id: string;
  body: string;
  /** Display-ready timestamp label (e.g. "Today, 4:20 PM", "2 days ago"). */
  createdAt: string;
  conversationId?: string;
};

const STORAGE_KEY = "cj.applications.notes";

type NotesMap = Record<string, PrivateNote[]>;

function readMap(): NotesMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as NotesMap) : {};
  } catch {
    return {};
  }
}

/** Saved notes for a conversation, or null when none were ever stored locally. */
export function loadNotes(conversationId: string): PrivateNote[] | null {
  const list = readMap()[conversationId];
  return Array.isArray(list) ? list : null;
}

export function saveNotes(conversationId: string, notes: PrivateNote[]): void {
  try {
    const map = readMap();
    map[conversationId] = notes;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage can be unavailable (private mode); the stack still works in-memory.
  }
}

export function makeNoteId(): string {
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** "Today, 4:20 PM" for a just-created note. */
export function formatNoteTimestamp(date: Date = new Date()): string {
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Today, ${time}`;
}
