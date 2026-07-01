// Pure helpers for rendering real backend messages in the inbox thread. Kept
// framework-free so the sender-side / unread logic is unit-testable without a DOM.

export type ChatThreadMessage = {
  id: string;
  fromMe: boolean;
  senderName: string;
  body: string;
  atLabel: string;
};

type BackendMessageLike = {
  id: string;
  from_me: boolean;
  sender_name?: string | null;
  body: string;
  created_at?: string | null;
};

/**
 * Map a persisted backend message to the inbox thread bubble shape. `from_me`
 * decides which side it renders on; the counterparty name labels the other side.
 */
export function mapBackendMessage(
  message: BackendMessageLike,
  counterpartyName: string,
  formatTime: (iso?: string | null) => string
): ChatThreadMessage {
  return {
    id: message.id,
    fromMe: message.from_me,
    senderName: message.from_me ? "You" : message.sender_name || counterpartyName,
    body: message.body,
    atLabel: formatTime(message.created_at),
  };
}

/** Whether a conversation has messages the viewer hasn't read. */
export function conversationHasUnread(conversation: { unread_count?: number } | null | undefined): boolean {
  return Boolean(conversation && (conversation.unread_count ?? 0) > 0);
}

/**
 * Map of inbox-thread id -> unread message count, for badging the conversation list.
 * The thread id is the application/interest id (== OwnerInteraction id). Only threads
 * with unread messages are included, so a missing key means "read".
 */
export function buildUnreadByThread(
  conversations: Array<{ thread_id: string; unread_count: number }>
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const conversation of conversations) {
    if (conversation.unread_count > 0) map[conversation.thread_id] = conversation.unread_count;
  }
  return map;
}

/** Total unread messages across all threads (for a header/tab indicator). */
export function totalUnread(unreadByThread: Record<string, number>): number {
  return Object.values(unreadByThread).reduce((sum, count) => sum + count, 0);
}

/** Cap a badge count for display, e.g. 9+ for anything over the cap. */
export function formatBadgeCount(count: number, cap = 9): string {
  return count > cap ? `${cap}+` : String(count);
}
