// Pure helpers for rendering real backend messages in the inbox thread. Kept
// framework-free so the sender-side / unread logic is unit-testable without a DOM.

export type ScreeningQuestionSnapshot = {
  id?: string;
  position?: number;
  prompt: string;
  required: boolean;
  response_guidance?: string | null;
};

/**
 * One asked question and what was said back.
 *
 * The prompt travels with the answer rather than being looked up, so editing
 * the job later cannot change the question a reviewer sees above an answer
 * somebody already gave.
 */
export type ScreeningAnswerSnapshot = {
  position: number;
  prompt: string;
  required: boolean;
  response: string;
  answered: boolean;
};

export type ChatThreadMessage = {
  id: string;
  fromMe: boolean;
  senderName: string;
  body: string;
  createdAt?: string | null;
  readByRecipient?: boolean;
  /**
   * "status" for platform-generated pipeline updates; "screening" for the automated
   * screening-question message sent by the hiring side after an application.
   */
  kind?: "status" | "screening" | "screening-answers";
  /** Structured snapshot for the automated screening-question message. */
  screening?: {
    automated: boolean;
    questions: ScreeningQuestionSnapshot[];
  };
  /**
   * The applicant's answers, paired with the questions *as they were asked*.
   * Every asked question appears, answered or not: an unanswered optional
   * question has to be distinguishable from one that was never put.
   */
  screeningAnswers?: {
    answers: ScreeningAnswerSnapshot[];
    answeredAt?: string | null;
  };
  /**
   * True when the sender used a composer intent that genuinely asked for
   * something. The only evidence that justifies a high-confidence "needs your
   * reply" work state — a message merely arriving never does.
   */
  responseExpected?: boolean;
};

type BackendMessageLike = {
  id: string;
  from_me: boolean;
  sender_name?: string | null;
  body: string;
  kind?: string | null;
  message_kind?: string | null;
  automated?: boolean;
  screening?: { questions?: ScreeningQuestionSnapshot[] } | null;
  screening_answers?: { answers?: ScreeningAnswerSnapshot[]; answered_at?: string | null } | null;
  created_at?: string | null;
  read_by_recipient?: boolean;
  response_expected?: boolean;
};

/**
 * Map a persisted backend message to the inbox thread bubble shape. `from_me`
 * decides which side it renders on; the counterparty name labels the other side.
 */
export function mapBackendMessage(
  message: BackendMessageLike,
  counterpartyName: string
): ChatThreadMessage {
  const isScreening = message.message_kind === "screening_questions";
  const isAnswers = message.message_kind === "screening_answers";
  return {
    id: message.id,
    fromMe: message.from_me,
    senderName: message.from_me ? "You" : message.sender_name || counterpartyName,
    body: message.body,
    createdAt: message.created_at,
    readByRecipient: Boolean(message.read_by_recipient),
    responseExpected: Boolean(message.response_expected),
    kind: isScreening
      ? "screening"
      : isAnswers
        ? "screening-answers"
        : message.kind === "status_update" || message.kind === "engagement_update"
          ? "status"
          : undefined,
    screening: isScreening
      ? {
          automated: Boolean(message.automated),
          questions: Array.isArray(message.screening?.questions) ? message.screening!.questions : [],
        }
      : undefined,
    screeningAnswers: isAnswers
      ? {
          answers: Array.isArray(message.screening_answers?.answers)
            ? message.screening_answers!.answers!
            : [],
          answeredAt: message.screening_answers?.answered_at ?? null,
        }
      : undefined,
  };
}

/** Whether a conversation has messages the viewer hasn't read. */
export function conversationHasUnread(conversation: { unread_count?: number } | null | undefined): boolean {
  return Boolean(conversation && (conversation.unread_count ?? 0) > 0);
}

/**
 * Return whether a foreground conversation contains a newer incoming message
 * than the viewer's durable read progress. This intentionally does not depend
 * on an unread-count event arriving first: message and unread socket events can
 * cross in flight, while the persisted timestamps remain authoritative.
 */
export function hasUnreadIncomingMessage(
  messages: BackendMessageLike[],
  viewerLastReadAt?: string | null
): boolean {
  const viewerReadAt = viewerLastReadAt ? Date.parse(viewerLastReadAt) : Number.NaN;
  return messages.some((message) => {
    if (message.from_me) return false;
    const createdAt = message.created_at ? Date.parse(message.created_at) : Number.NaN;
    return Number.isFinite(createdAt) && (!Number.isFinite(viewerReadAt) || createdAt > viewerReadAt);
  });
}

/**
 * Reconcile an outgoing message with the conversation's durable counterparty
 * read timestamp. Real-time read progress can arrive before the sender's POST
 * response or message-created event, so receipt state must be order-independent.
 */
export function reconcileMessageReceipt<T extends BackendMessageLike>(
  message: T,
  counterpartyLastReadAt?: string | null
): T {
  if (!message.from_me || message.read_by_recipient || !message.created_at || !counterpartyLastReadAt) {
    return message;
  }
  const createdAt = Date.parse(message.created_at);
  const readAt = Date.parse(counterpartyLastReadAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(readAt) || createdAt > readAt) {
    return message;
  }
  return { ...message, read_by_recipient: true };
}

/** True only while the latest ordinary outgoing message awaits a receipt. */
export function hasPendingLatestOutgoingReceipt(messages: BackendMessageLike[]): boolean {
  const latest = [...messages]
    .reverse()
    .find(
      (message) =>
        message.from_me &&
        message.kind !== "status_update" &&
        message.kind !== "engagement_update" &&
        message.kind !== "screening_questions"
    );
  return Boolean(latest && !latest.read_by_recipient);
}

/** Private application data stays backend-backed even if public browse uses mocks. */
export function shouldUseLiveApplicationsData(
  backendAccessToken?: string | null,
  forceMock = false
): boolean {
  return Boolean(backendAccessToken) && !forceMock;
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

/** Pipeline presentation may archive successful outcomes, but chat closes only
 * for terminal outcomes where no ongoing collaboration exists. */
export function isMessagingClosedStatus(status: string): boolean {
  return ["declined", "withdrawn", "closed"].includes(status);
}
