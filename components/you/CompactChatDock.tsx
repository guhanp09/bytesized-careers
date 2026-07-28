"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icons";
import { groupConversation } from "../../lib/systemEventGrouping";
import { InteractionTime } from "./InteractionTime";
import {
  buildConversation,
  InteractionAvatar,
  MessageGroup,
  StatusUpdateLine,
  SystemEventGroup,
  type ChatMessage,
} from "./ApplicationsWorkspace";
import {
  formatBadgeCount,
  hasPendingLatestOutgoingReceipt,
  hasUnreadIncomingMessage,
  isMessagingClosedStatus,
  mapBackendMessage,
  reconcileMessageReceipt,
  totalUnread,
} from "../../lib/messaging";
import {
  getApplicationConversation,
  getInterestConversation,
  markConversationRead,
  sendConversationMessage,
  type BackendConversation,
  type BackendMessage,
} from "../../lib/backendClient";
import {
  interactionKindLabel,
  isArchivedInteraction,
  type OwnerInteraction,
} from "../../lib/ownerInteractions";
import { purgeLegacyStorageKey, userStorageKey } from "../../lib/userScopedStorage";
import { useRealtimeMessaging, type RealtimeMessagingEvent } from "../../lib/realtimeMessaging";
import { directionLabelsFor, pipelineProfileHrefOf, type WorkspaceModeKey } from "../../lib/applicationPipeline";

/**
 * Facebook-style compact chat companion for the applications workspace: a
 * launcher pill in the bottom-right corner that expands into a minimizable
 * dock mirroring the Inbox — a filterable thread list, a compact conversation
 * with the same message bubbles, and a working composer — so users can message
 * from the Pipeline (or anywhere in the workspace) without switching screens.
 */

type DockFilter = "all" | "sent" | "received" | "archived";
const CONVERSATION_POLL_INTERVAL_MS = 3_000;
type DockLiveThread = { conversationId: string; messages: BackendMessage[]; conversation?: BackendConversation };

// Remembers the dock's open state + active thread across navigation, so returning
// to the workspace reopens the same conversation instead of the default list. The
// key is scoped per backend user so no other account's dock state can restore.
const DOCK_STORAGE_KEY = "cj.applications.chatdock";

type DockPersistedState = { open: boolean; threadId: string | null };

function readDockState(storageKey: string): DockPersistedState | null {
  try {
    purgeLegacyStorageKey(DOCK_STORAGE_KEY);
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DockPersistedState>;
    return {
      open: Boolean(parsed.open),
      threadId: typeof parsed.threadId === "string" ? parsed.threadId : null,
    };
  } catch {
    return null;
  }
}

/** Same workflow names as the workspace filters (received leads). */
function dockFiltersFor(mode: WorkspaceModeKey): Array<{ key: DockFilter; label: string }> {
  const labels = directionLabelsFor(mode);
  return [
    { key: "all", label: "All" },
    { key: "received", label: labels.received },
    { key: "sent", label: labels.sent },
    { key: "archived", label: "Archived" },
  ];
}

type CompactChatDockProps = {
  items: OwnerInteraction[];
  mode: WorkspaceModeKey;
  liveMode: boolean;
  backendAccessToken?: string;
  /** Backend user id of the signed-in account; scopes persisted dock state. */
  backendUserId?: string;
  unreadByThread: Record<string, number>;
  onThreadRead: (id: string) => void;
  /** Bumped by "Message" actions elsewhere (e.g. pipeline cards) to open a thread. */
  openRequest: { id: string; nonce: number } | null;
  /** Demo-mode reply persistence (parent owns the items state). */
  onDemoReply: (id: string, body: string) => void;
  /** Jump to the full Inbox view with this thread selected. */
  onOpenInInbox: (id: string) => void;
};

export default function CompactChatDock({
  items,
  mode,
  liveMode,
  backendAccessToken,
  backendUserId,
  unreadByThread,
  onThreadRead,
  openRequest,
  onDemoReply,
  onOpenInInbox,
}: CompactChatDockProps) {
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [filter, setFilter] = useState<DockFilter>("all");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [liveThreads, setLiveThreads] = useState<
    Record<string, DockLiveThread>
  >({});
  const [typingByConversation, setTypingByConversation] = useState<
    Record<string, { senderUserId: string; expiresAt: number }>
  >({});
  const typingTimersRef = useRef<Record<string, number>>({});
  const readInFlightRef = useRef<Set<string>>(new Set());
  const [realtimeRefreshNonce, setRealtimeRefreshNonce] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const handledNonce = useRef(0);
  const restoredDock = useRef(false);
  const skipFirstPersist = useRef(true);
  const pendingSendRef = useRef<{ threadId: string; body: string; id: string } | null>(null);

  const handleRealtimeEvent = useCallback((event: RealtimeMessagingEvent) => {
    if (event.type === "connected") {
      setRealtimeRefreshNonce((value) => value + 1);
      return;
    }
    if (event.type === "conversation.unread") {
      setLiveThreads((previous) => {
        const threadId = Object.entries(previous).find(
          ([, thread]) => thread.conversationId === event.conversation_id
        )?.[0];
        if (!threadId) return previous;
        const thread = previous[threadId];
        if (!thread.conversation) return previous;
        return {
          ...previous,
          [threadId]: {
            ...thread,
            conversation: { ...thread.conversation, unread_count: event.unread_count },
          },
        };
      });
      return;
    }
    if (event.type === "message.created") {
      setLiveThreads((previous) => {
        const existing = previous[event.thread_id];
        if (!existing || existing.conversationId !== event.conversation_id) return previous;
        if (existing.messages.some((message) => message.id === event.message.id)) return previous;
        const message = reconcileMessageReceipt(
          event.message,
          existing.conversation?.counterparty_last_read_at
        );
        return { ...previous, [event.thread_id]: { ...existing, messages: [...existing.messages, message] } };
      });
      window.clearTimeout(typingTimersRef.current[event.conversation_id]);
      setTypingByConversation((previous) => {
        if (!previous[event.conversation_id]) return previous;
        const next = { ...previous };
        delete next[event.conversation_id];
        return next;
      });
      return;
    }
    if (event.type === "conversation.read_progress") {
      setLiveThreads((previous) => {
        const next: Record<string, DockLiveThread> = {};
        let changed = false;
        for (const [id, thread] of Object.entries(previous)) {
          if (thread.conversationId !== event.conversation_id) {
            next[id] = thread;
            continue;
          }
          changed = true;
          const readAt = Date.parse(event.read_at);
          next[id] = {
            ...thread,
            conversation: thread.conversation
              ? { ...thread.conversation, counterparty_last_read_at: event.read_at }
              : thread.conversation,
            messages: thread.messages.map((message) => {
              const createdAt = message.created_at ? Date.parse(message.created_at) : Number.NaN;
              return message.from_me && Number.isFinite(createdAt) && createdAt <= readAt
                ? { ...message, read_by_recipient: true }
                : message;
            }),
          };
        }
        return changed ? next : previous;
      });
      return;
    }
    if (event.type === "conversation.typing") {
      window.clearTimeout(typingTimersRef.current[event.conversation_id]);
      if (!event.is_typing) {
        setTypingByConversation((previous) => {
          if (!previous[event.conversation_id]) return previous;
          const next = { ...previous };
          delete next[event.conversation_id];
          return next;
        });
        return;
      }
      setTypingByConversation((previous) => ({
        ...previous,
        [event.conversation_id]: { senderUserId: event.sender_user_id, expiresAt: Date.now() + 6_500 },
      }));
      typingTimersRef.current[event.conversation_id] = window.setTimeout(() => {
        setTypingByConversation((previous) => {
          if (!previous[event.conversation_id]) return previous;
          const next = { ...previous };
          delete next[event.conversation_id];
          return next;
        });
      }, 6_500);
      return;
    }
    if (event.type === "interaction.blocked") {
      setTypingByConversation({});
      setRealtimeRefreshNonce((value) => value + 1);
    }
  }, []);
  const {
    state: realtimeState,
    subscribeConversation,
    sendTyping,
  } = useRealtimeMessaging({
    enabled: liveMode,
    accessToken: backendAccessToken,
    backendUserId,
    onEvent: handleRealtimeEvent,
  });

  const dockStorageKey = userStorageKey(DOCK_STORAGE_KEY, backendUserId);

  // Restore the last dock state on mount (client-only, once) so navigating away
  // and back returns to the same open conversation.
  useEffect(() => {
    if (restoredDock.current) return;
    restoredDock.current = true;
    const saved = readDockState(dockStorageKey);
    if (saved?.open) {
      if (saved.threadId) setThreadId(saved.threadId);
      setOpen(true);
    }
    // Restore runs once against the mount-time storage key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist open + thread on change. Skip the very first run so the initial
  // default render can't clobber the restored value before it lands.
  useEffect(() => {
    if (skipFirstPersist.current) {
      skipFirstPersist.current = false;
      return;
    }
    try {
      window.localStorage.setItem(dockStorageKey, JSON.stringify({ open, threadId }));
    } catch {
      // Storage can be unavailable (private mode); the dock still works in-session.
    }
  }, [open, threadId, dockStorageKey]);

  const thread = threadId ? items.find((item) => item.id === threadId) ?? null : null;
  const activeThreadId = thread?.id ?? null;
  const activeConversationId = activeThreadId ? liveThreads[activeThreadId]?.conversationId ?? null : null;
  const activeNeedsRead = activeThreadId
    ? hasUnreadIncomingMessage(
        liveThreads[activeThreadId]?.messages ?? [],
        liveThreads[activeThreadId]?.conversation?.viewer_last_read_at
      )
    : false;
  const openRequestId = openRequest?.id ?? null;
  const openRequestNonce = openRequest?.nonce ?? 0;

  useEffect(() => {
    if (!liveMode || !activeConversationId) return;
    return subscribeConversation(activeConversationId);
  }, [liveMode, activeConversationId, subscribeConversation]);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(typingTimersRef.current)) window.clearTimeout(timer);
      typingTimersRef.current = {};
    };
  }, []);

  // Socket-delivered messages in the dock's foreground thread should become
  // receipts immediately, just like the full Inbox. The HTTP endpoint keeps
  // progress monotonic and retry-safe if the socket or request fails.
  useEffect(() => {
    if (
      !open ||
      !liveMode ||
      !backendAccessToken ||
      !activeThreadId ||
      !activeConversationId ||
      !activeNeedsRead ||
      document.visibilityState !== "visible" ||
      readInFlightRef.current.has(activeConversationId)
    ) {
      return;
    }
    let cancelled = false;
    readInFlightRef.current.add(activeConversationId);
    void markConversationRead(backendAccessToken, activeConversationId)
      .then((conversation) => {
        if (cancelled) return;
        setLiveThreads((previous) => {
          const thread = previous[activeThreadId];
          return thread
            ? { ...previous, [activeThreadId]: { ...thread, conversation } }
            : previous;
        });
        onThreadRead(activeThreadId);
      })
      .catch(() => {
        // The existing selected-thread loader retries through HTTP fallback.
      })
      .finally(() => {
        readInFlightRef.current.delete(activeConversationId);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeConversationId,
    activeNeedsRead,
    activeThreadId,
    backendAccessToken,
    liveMode,
    onThreadRead,
    open,
  ]);

  // A "Message" action anywhere in the workspace opens the dock on that thread.
  useEffect(() => {
    if (!openRequest || openRequest.nonce === handledNonce.current) return;
    handledNonce.current = openRequest.nonce;
    setThreadId(openRequest.id);
    setOpen(true);
    setDraft("");
    setSendError(null);
  }, [openRequest]);

  useEffect(() => {
    if (!open || !activeThreadId || openRequestId !== activeThreadId) return;
    const timer = window.setTimeout(() => composerRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [open, activeThreadId, openRequestId, openRequestNonce]);

  // Keep the dock's open conversation current and mark it read. Requests are
  // sequential and pause while sending so a stale poll cannot replace a message
  // that was just returned by the backend.
  const threadKind = thread?.kind ?? null;
  useEffect(() => {
    if (
      !open ||
      !liveMode ||
      !backendAccessToken ||
      !threadId ||
      !threadKind ||
      sending
    ) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setLoadFailed(false);

    const refreshConversation = async () => {
      let nextPollMs =
        realtimeState === "connected" ? 15_000 : CONVERSATION_POLL_INTERVAL_MS;
      try {
        const detail = await (threadKind === "hiring_request"
          ? getInterestConversation(backendAccessToken, threadId)
          : getApplicationConversation(backendAccessToken, threadId));
        if (cancelled) return;
        if (hasPendingLatestOutgoingReceipt(detail.messages)) {
          nextPollMs = Math.min(nextPollMs, 2_500);
        }
        setLiveThreads((prev) => ({
          ...prev,
          [threadId]: {
            conversationId: detail.conversation.id,
            messages: detail.messages,
            conversation: detail.conversation,
          },
        }));
        setLoadFailed(false);
        if (detail.conversation.unread_count > 0 && document.visibilityState === "visible") {
          void markConversationRead(backendAccessToken, detail.conversation.id)
            .then((conversation) => {
              if (cancelled) return;
              setLiveThreads((previous) => {
                const current = previous[threadId];
                return current
                  ? { ...previous, [threadId]: { ...current, conversation } }
                  : previous;
              });
            })
            .catch(() => {});
        }
        onThreadRead(threadId);
      } catch {
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) {
          timer = setTimeout(refreshConversation, nextPollMs);
        }
      }
    };

    void refreshConversation();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    open,
    liveMode,
    backendAccessToken,
    threadId,
    threadKind,
    sending,
    onThreadRead,
    realtimeRefreshNonce,
    realtimeState,
  ]);

  const conversation: ChatMessage[] = useMemo(() => {
    if (!thread) return [];
    const liveMessages =
      liveMode && liveThreads[thread.id]
        ? liveThreads[thread.id].messages.map((message) =>
            mapBackendMessage(message, thread.counterpartyName)
          )
        : [];
    return [...buildConversation(thread), ...liveMessages];
  }, [thread, liveMode, liveThreads]);

  // Keep the newest message in view.
  useEffect(() => {
    if (!open || !thread) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [open, thread, conversation.length]);

  const filteredThreads = useMemo(() => {
    if (filter === "sent") return items.filter((item) => item.direction === "sent");
    if (filter === "received") return items.filter((item) => item.direction === "received");
    if (filter === "archived") return items.filter(isArchivedInteraction);
    return items;
  }, [items, filter]);

  const unreadCount = liveMode ? totalUnread(unreadByThread) : items.filter((item) => item.unread).length;

  const threadLive = thread && liveMode ? liveThreads[thread.id] : undefined;
  const threadInteractionBlocked = Boolean(threadLive?.conversation?.interaction_blocked);
  const threadBlockedByMe = Boolean(threadLive?.conversation?.blocked_by_me);
  const threadMessagingClosed = thread
    ? liveMode
      ? Boolean(threadLive?.conversation?.is_closed) || threadInteractionBlocked
      : isMessagingClosedStatus(thread.status) || threadInteractionBlocked
    : false;
  const composerReady = Boolean(thread) && !threadMessagingClosed && (!liveMode || Boolean(threadLive));
  const latestOutgoing = [...conversation]
    .reverse()
    .find((message) => message.fromMe && message.kind !== "status");
  const latestOutgoingMessageId = latestOutgoing?.id;
  const latestOutgoingRead = Boolean(latestOutgoing?.readByRecipient);
  // A dock thread is one-to-one by construction, so a name above every run
  // would say only what the dock's own header already says.
  const typing = activeConversationId ? typingByConversation[activeConversationId] : null;

  const send = async () => {
    const body = draft.trim();
    if (!body || !thread || sending) return;
    if (liveMode && backendAccessToken) {
      const cache = liveThreads[thread.id];
      if (!cache) return;
      setSending(true);
      setSendError(null);
      const previousAttempt = pendingSendRef.current;
      const clientMessageId =
        previousAttempt?.threadId === thread.id && previousAttempt.body === body
          ? previousAttempt.id
          : window.crypto.randomUUID();
      pendingSendRef.current = { threadId: thread.id, body, id: clientMessageId };
      sendTyping(cache.conversationId, false);
      window.clearTimeout(typingTimersRef.current[cache.conversationId]);
      try {
        const message = await sendConversationMessage(
          backendAccessToken,
          cache.conversationId,
          body,
          clientMessageId
        );
        setLiveThreads((prev) => {
          const current = prev[thread.id];
          if (!current || current.messages.some((entry) => entry.id === message.id)) return prev;
          const reconciled = reconcileMessageReceipt(
            message,
            current.conversation?.counterparty_last_read_at
          );
          return { ...prev, [thread.id]: { ...current, messages: [...current.messages, reconciled] } };
        });
        if (pendingSendRef.current?.id === clientMessageId) pendingSendRef.current = null;
        setDraft("");
      } catch {
        setSendError("Message could not be sent. Please try again.");
      } finally {
        setSending(false);
      }
      return;
    }
    onDemoReply(thread.id, body);
    setDraft("");
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    if (!liveMode || !activeConversationId || !composerReady) return;
    sendTyping(activeConversationId, Boolean(value.trim()));
    window.clearTimeout(typingTimersRef.current[activeConversationId]);
    if (value.trim()) {
      typingTimersRef.current[activeConversationId] = window.setTimeout(() => {
        sendTyping(activeConversationId, false);
      }, 1_250);
    }
  };

  // ---- Minimized launcher -------------------------------------------------
  if (!open) {
    return (
      <button
        type="button"
        data-testid="chat-dock-launcher"
        onClick={() => setOpen(true)}
        aria-label="Open messages"
        className="hidden h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-line-mid bg-[#131419]/95 px-3.5 text-xs font-semibold text-white/75 shadow-[0_14px_40px_-18px_rgba(0,0,0,0.95)] backdrop-blur transition-colors hover:border-line-strong hover:text-white sm:inline-flex"
      >
        <Icon name="message-square-text" className="h-4 w-4" />
        Messages
        {unreadCount > 0 ? (
          <span
            data-testid="chat-dock-unread"
            className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-white px-1 text-[10px] font-semibold leading-none text-black"
          >
            {formatBadgeCount(unreadCount)}
          </span>
        ) : null}
      </button>
    );
  }

  // ---- Open dock -----------------------------------------------------------
  return (
    <div
      data-testid="chat-dock-panel"
      className="hidden w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-line-mid bg-[#101014]/[0.99] shadow-[0_32px_90px_-30px_rgba(0,0,0,1)] backdrop-blur-xl sm:flex"
      style={{ height: "min(460px, 70vh)" }}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
        {thread ? (
          <>
            <button
              type="button"
              data-testid="chat-dock-back"
              onClick={() => setThreadId(null)}
              aria-label="Back to messages"
              className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-elevated hover:text-white"
            >
              <span aria-hidden>←</span>
            </button>
            {(() => {
              const href = pipelineProfileHrefOf(thread);
              const identity = (
                <span className="flex min-w-0 items-center gap-2">
                  <InteractionAvatar
                    name={thread.counterpartyName}
                    src={thread.counterpartyAvatarUrl}
                    sizeClasses="h-7 w-7"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold leading-tight text-white">
                      {thread.counterpartyName}
                    </span>
                    <span className="block truncate text-[10px] text-subtle">
                      {interactionKindLabel(thread)}
                    </span>
                  </span>
                </span>
              );
              return href ? (
                <Link
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 transition-opacity hover:opacity-85"
                >
                  {identity}
                </Link>
              ) : (
                <span className="min-w-0 flex-1">{identity}</span>
              );
            })()}
            <button
              type="button"
              data-testid="chat-dock-open-inbox"
              onClick={() => {
                setOpen(false);
                onOpenInInbox(thread.id);
              }}
              aria-label="Open in Inbox"
              title="Open in Inbox"
              className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-elevated hover:text-white"
            >
              <Icon name="external-link" className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <p className="min-w-0 flex-1 px-1 text-[13px] font-semibold text-white">Messages</p>
        )}
        <button
          type="button"
          data-testid="chat-dock-minimize"
          onClick={() => setOpen(false)}
          aria-label="Minimize chat"
          className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-elevated hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>

      {thread ? (
        <>
          {/* Conversation — same bubbles as the full Inbox, compact canvas */}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {conversation.length > 0 ? (
              <div className="space-y-4">
                {/*
                  The same grouping the full thread uses, from the same module.
                  The dock used to print every status line separately, so a
                  record with a run of updates read as six near-identical rows
                  here and as one "6 updates" summary in the Inbox — the same
                  history told two different ways depending on where you opened
                  it.
                */}
                {groupConversation(conversation).map((entry) =>
                  entry.type === "system-group" ? (
                    <SystemEventGroup key={entry.id} summary={entry.summary} events={entry.events} />
                  ) : entry.type === "status" ? (
                    <StatusUpdateLine key={entry.message.id} message={entry.message} />
                  ) : (
                    <MessageGroup
                      key={entry.id}
                      senderName={entry.senderName}
                      fromMe={entry.fromMe}
                      messages={entry.messages}
                      latestAt={entry.latestAt}
                      counterpartyAvatarUrl={thread.counterpartyAvatarUrl}
                      counterpartyHref={pipelineProfileHrefOf(thread)}
                      seenMessageId={
                        latestOutgoingMessageId && latestOutgoingRead ? latestOutgoingMessageId : null
                      }
                      density="compact"
                    />
                  )
                )}
              </div>
            ) : (
              <p className="px-2 py-8 text-center text-xs text-subtle">No messages yet.</p>
            )}
            {typing ? (
              <p data-testid="chat-dock-typing" className="mt-3 px-1 text-[10.5px] font-medium text-muted">
                {thread.counterpartyName.split(/\s+/)[0]} is typing…
              </p>
            ) : null}
          </div>
          {/* Composer */}
          <div className="shrink-0 border-t border-line px-2.5 py-2">
            {threadInteractionBlocked ? (
              <p className="px-1.5 py-1 text-[11px] text-subtle">
                {threadBlockedByMe
                  ? `You blocked ${thread.counterpartyName.split(/\s+/)[0]}. Open Inbox to unblock.`
                  : "This conversation is unavailable for new messages."}
              </p>
            ) : threadMessagingClosed ? (
              <p className="px-1.5 py-1 text-[11px] text-subtle">This thread is closed to new messages.</p>
            ) : (
              <>
                <div className="flex items-end gap-1.5 rounded-xl border border-line bg-wash p-1.5 transition-colors focus-within:border-line-strong">
                  <textarea
                    ref={composerRef}
                    value={draft}
                    onChange={(event) => handleDraftChange(event.target.value)}
                    maxLength={5000}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                    rows={1}
                    data-testid="chat-dock-composer"
                    aria-label="Reply message"
                    placeholder={`Message ${thread.counterpartyName.split(/\s+/)[0]}…`}
                    className="max-h-24 min-h-[32px] flex-1 resize-none bg-transparent px-2 py-1 text-[13px] leading-relaxed text-white/85 placeholder:text-subtle focus:outline-none"
                  />
                  <button
                    type="button"
                    data-testid="chat-dock-send"
                    aria-label="Send"
                    onClick={() => void send()}
                    disabled={!draft.trim() || sending || !composerReady}
                    className={
                      draft.trim() && !sending && composerReady
                        ? "inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-white text-black transition-colors hover:bg-white/90"
                        : "inline-flex h-8 w-8 shrink-0 cursor-not-allowed items-center justify-center rounded-lg border border-line bg-wash text-subtle"
                    }
                  >
                    <Icon name="send" className="h-3.5 w-3.5" />
                  </button>
                </div>
                {sendError ? (
                  <p className="mt-1 px-1 text-[10px] text-rose-300/80">{sendError}</p>
                ) : liveMode && !threadLive ? (
                  <p className="mt-1 px-1 text-[10px] text-subtle">
                    {loadFailed ? "Couldn’t load this conversation. Retrying…" : "Loading conversation…"}
                  </p>
                ) : !liveMode ? (
                  <p className="mt-1 px-1 text-[10px] text-subtle">Demo only — replies aren’t delivered yet.</p>
                ) : null}
              </>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Thread list — the Inbox's filters + rows, compact */}
          <div className="flex shrink-0 items-end gap-4 overflow-x-auto border-b border-line px-3">
            {dockFiltersFor(mode).map((option) => {
              const isActive = filter === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  data-testid={`chat-dock-filter-${option.key}`}
                  aria-pressed={isActive}
                  onClick={() => setFilter(option.key)}
                  className={[
                    "relative h-8 shrink-0 cursor-pointer text-[11px] font-semibold transition-colors",
                    isActive ? "text-white" : "text-muted hover:text-white/75",
                  ].join(" ")}
                >
                  {option.label}
                  <span
                    className={[
                      "absolute inset-x-0 bottom-0 h-[2px] rounded-full",
                      isActive ? "bg-white" : "bg-transparent",
                    ].join(" ")}
                  />
                </button>
              );
            })}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredThreads.length === 0 ? (
              <p className="px-4 py-10 text-center text-xs text-subtle">Nothing here yet.</p>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {filteredThreads.map((item) => {
                  const messageUnread = liveMode ? unreadByThread[item.id] ?? 0 : 0;
                  const rowUnread = Boolean(item.unread) || messageUnread > 0;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-testid="chat-dock-thread-row"
                      onClick={() => {
                        setThreadId(item.id);
                        setDraft("");
                        setSendError(null);
                      }}
                      className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-raised"
                    >
                      <InteractionAvatar
                        name={item.counterpartyName}
                        src={item.counterpartyAvatarUrl}
                        sizeClasses="h-8 w-8"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          {rowUnread ? (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/90" aria-hidden />
                          ) : null}
                          <span
                            className={[
                              "truncate text-[13px]",
                              rowUnread ? "font-semibold text-white" : "font-medium text-white/85",
                            ].join(" ")}
                          >
                            {item.counterpartyName}
                          </span>
                        </span>
                        <span className="block truncate text-[10.5px] text-subtle">
                          {interactionKindLabel(item)}
                        </span>
                      </span>
                      {messageUnread > 0 ? (
                        <span className="inline-flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full bg-white px-1 text-[10px] font-semibold leading-none text-black">
                          {formatBadgeCount(messageUnread)}
                        </span>
                      ) : null}
                      <InteractionTime value={item.updatedAt} className="shrink-0 text-[10.5px] text-subtle" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
