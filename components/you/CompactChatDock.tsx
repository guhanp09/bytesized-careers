"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icons";
import {
  buildConversation,
  InteractionAvatar,
  MessageBubble,
  StatusUpdateLine,
  type ChatMessage,
} from "./ApplicationsWorkspace";
import { formatBadgeCount, mapBackendMessage, totalUnread } from "../../lib/messaging";
import {
  getApplicationConversation,
  getInterestConversation,
  markConversationRead,
  sendConversationMessage,
  type BackendMessage,
} from "../../lib/backendClient";
import {
  interactionKindLabel,
  isArchivedInteraction,
  relativeTimeLabel,
  type OwnerInteraction,
} from "../../lib/ownerInteractions";
import { directionLabelsFor, pipelineProfileHrefOf, type WorkspaceModeKey } from "../../lib/applicationPipeline";

/**
 * Facebook-style compact chat companion for the applications workspace: a
 * launcher pill in the bottom-right corner that expands into a minimizable
 * dock mirroring the Inbox — a filterable thread list, a compact conversation
 * with the same message bubbles, and a working composer — so users can message
 * from the Pipeline (or anywhere in the workspace) without switching screens.
 */

type DockFilter = "all" | "sent" | "received" | "archived";

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
  unreadByThread: Record<string, number>;
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
  unreadByThread,
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
  const [liveThreads, setLiveThreads] = useState<
    Record<string, { conversationId: string; messages: BackendMessage[] }>
  >({});
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const handledNonce = useRef(0);

  const thread = threadId ? items.find((item) => item.id === threadId) ?? null : null;
  const activeThreadId = thread?.id ?? null;
  const openRequestId = openRequest?.id ?? null;
  const openRequestNonce = openRequest?.nonce ?? 0;

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

  // Load the real conversation for the open thread (live mode) and mark it read —
  // the same contract the full Inbox uses (record id == OwnerInteraction id).
  const threadKind = thread?.kind ?? null;
  useEffect(() => {
    if (!open || !liveMode || !backendAccessToken || !threadId || !threadKind) return;
    let cancelled = false;
    const loader =
      threadKind === "hiring_request"
        ? getInterestConversation(backendAccessToken, threadId)
        : getApplicationConversation(backendAccessToken, threadId);
    loader
      .then((detail) => {
        if (cancelled) return;
        setLiveThreads((prev) => ({
          ...prev,
          [threadId]: { conversationId: detail.conversation.id, messages: detail.messages },
        }));
        if (detail.conversation.unread_count > 0) {
          void markConversationRead(backendAccessToken, detail.conversation.id).catch(() => {});
        }
      })
      .catch(() => {
        // Composer stays disabled until the conversation loads; opening message still renders.
      });
    return () => {
      cancelled = true;
    };
  }, [open, liveMode, backendAccessToken, threadId, threadKind]);

  const conversation: ChatMessage[] = useMemo(() => {
    if (!thread) return [];
    const liveMessages =
      liveMode && liveThreads[thread.id]
        ? liveThreads[thread.id].messages.map((message) =>
            mapBackendMessage(message, thread.counterpartyName, relativeTimeLabel)
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

  const threadArchived = thread ? isArchivedInteraction(thread) : false;
  const threadLive = thread && liveMode ? liveThreads[thread.id] : undefined;
  const composerReady = Boolean(thread) && !threadArchived && (!liveMode || Boolean(threadLive));

  const send = async () => {
    const body = draft.trim();
    if (!body || !thread || sending) return;
    if (liveMode && backendAccessToken) {
      const cache = liveThreads[thread.id];
      if (!cache) return;
      setSending(true);
      setSendError(null);
      try {
        const message = await sendConversationMessage(backendAccessToken, cache.conversationId, body);
        setLiveThreads((prev) => ({
          ...prev,
          [thread.id]: { ...cache, messages: [...cache.messages, message] },
        }));
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

  // ---- Minimized launcher -------------------------------------------------
  if (!open) {
    return (
      <button
        type="button"
        data-testid="chat-dock-launcher"
        onClick={() => setOpen(true)}
        aria-label="Open messages"
        className="hidden h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-white/[0.12] bg-[#131419]/95 px-3.5 text-xs font-semibold text-white/75 shadow-[0_14px_40px_-18px_rgba(0,0,0,0.95)] backdrop-blur transition-colors hover:border-white/25 hover:text-white sm:inline-flex"
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
      className="hidden w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#101014]/[0.99] shadow-[0_32px_90px_-30px_rgba(0,0,0,1)] backdrop-blur-xl sm:flex"
      style={{ height: "min(460px, 70vh)" }}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.07] px-3 py-2.5">
        {thread ? (
          <>
            <button
              type="button"
              data-testid="chat-dock-back"
              onClick={() => setThreadId(null)}
              aria-label="Back to messages"
              className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white"
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
                    <span className="block truncate text-[10px] text-white/40">
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
              className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/[0.07] hover:text-white"
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
          className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white"
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
                {conversation.map((message) =>
                  message.kind === "status" ? (
                    <StatusUpdateLine key={message.id} message={message} />
                  ) : (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      counterpartyAvatarUrl={thread.counterpartyAvatarUrl}
                      counterpartyHref={pipelineProfileHrefOf(thread)}
                    />
                  )
                )}
              </div>
            ) : (
              <p className="px-2 py-8 text-center text-xs text-white/40">No messages yet.</p>
            )}
          </div>
          {/* Composer */}
          <div className="shrink-0 border-t border-white/[0.07] px-2.5 py-2">
            {threadArchived ? (
              <p className="px-1.5 py-1 text-[11px] text-white/40">This thread is closed to new messages.</p>
            ) : (
              <>
                <div className="flex items-end gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1.5 transition-colors focus-within:border-white/25">
                  <textarea
                    ref={composerRef}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
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
                    className="max-h-24 min-h-[32px] flex-1 resize-none bg-transparent px-2 py-1 text-[13px] leading-relaxed text-white/85 placeholder:text-white/35 focus:outline-none"
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
                        : "inline-flex h-8 w-8 shrink-0 cursor-not-allowed items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.02] text-white/30"
                    }
                  >
                    <Icon name="send" className="h-3.5 w-3.5" />
                  </button>
                </div>
                {sendError ? (
                  <p className="mt-1 px-1 text-[10px] text-rose-300/80">{sendError}</p>
                ) : liveMode && !threadLive ? (
                  <p className="mt-1 px-1 text-[10px] text-white/35">Loading conversation…</p>
                ) : !liveMode ? (
                  <p className="mt-1 px-1 text-[10px] text-white/30">Demo only — replies aren’t delivered yet.</p>
                ) : null}
              </>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Thread list — the Inbox's filters + rows, compact */}
          <div className="flex shrink-0 items-end gap-4 overflow-x-auto border-b border-white/[0.07] px-3">
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
                    isActive ? "text-white" : "text-white/45 hover:text-white/75",
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
              <p className="px-4 py-10 text-center text-xs text-white/40">Nothing here yet.</p>
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
                      className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
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
                        <span className="block truncate text-[10.5px] text-white/40">
                          {interactionKindLabel(item)}
                        </span>
                      </span>
                      {messageUnread > 0 ? (
                        <span className="inline-flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full bg-white px-1 text-[10px] font-semibold leading-none text-black">
                          {formatBadgeCount(messageUnread)}
                        </span>
                      ) : null}
                      <span className="shrink-0 text-[10.5px] text-white/35">{item.updatedAtLabel}</span>
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
