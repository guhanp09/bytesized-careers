"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getBackendApiBaseUrl, type BackendMessage } from "./backendClient";

export type RealtimeConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "unavailable";

export type RealtimeMessagingEvent =
  | {
      type: "message.created";
      event_id: string;
      conversation_id: string;
      thread_id: string;
      message: BackendMessage;
    }
  | {
      type: "conversation.unread";
      event_id: string;
      conversation_id: string;
      thread_id: string;
      unread_count: number;
    }
  | {
      type: "conversation.read_progress";
      event_id: string;
      conversation_id: string;
      reader_user_id: string;
      read_at: string;
    }
  | {
      type: "conversation.typing";
      event_id: string;
      conversation_id: string;
      sender_user_id: string;
      is_typing: boolean;
      expires_at?: number | null;
    }
  | {
      type: "interaction.blocked";
      event_id: string;
      blocked: boolean;
    }
  | { type: "connected"; event_id: string }
  | { type: "subscribed"; event_id: string; conversation_id: string }
  | { type: "pong"; event_id: string }
  | { type: "error"; event_id: string; code: string };

type Listener = (event: RealtimeMessagingEvent) => void;
type StateListener = (state: RealtimeConnectionState, reconnected: boolean) => void;

const SOCKET_SUBPROTOCOL = "creatorjobs.realtime.v1";
const MAX_EVENT_IDS = 400;
const MAX_RECONNECT_DELAY_MS = 8_000;
const TYPING_THROTTLE_MS = 650;
let nextLeaseId = 1;

function realtimeUrl(): string {
  const url = new URL(`${getBackendApiBaseUrl()}/ws/conversations`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function asRealtimeEvent(value: unknown): RealtimeMessagingEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  if (typeof event.type !== "string" || typeof event.event_id !== "string") return null;
  return event as unknown as RealtimeMessagingEvent;
}

/** One browser-session socket, shared by full Inbox and compact chat consumers. */
class RealtimeMessagingClient {
  private socket: WebSocket | null = null;
  private leases = new Set<number>();
  private listeners = new Map<number, Listener>();
  private stateListeners = new Map<number, StateListener>();
  private subscriptions = new Map<string, Set<number>>();
  private seenEventIds = new Set<string>();
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private manualClose = false;
  private hasConnected = false;
  private visibilityListener: (() => void) | null = null;
  private typingLastSentAt = new Map<string, number>();

  constructor(
    private readonly accessToken: string,
    private readonly backendUserId: string
  ) {}

  acquire(leaseId: number, listener: Listener, stateListener: StateListener): void {
    if (this.leases.size === 0) this.manualClose = false;
    this.leases.add(leaseId);
    this.listeners.set(leaseId, listener);
    this.stateListeners.set(leaseId, stateListener);
    stateListener(this.currentState(), false);
    if (!this.visibilityListener) {
      this.visibilityListener = () => {
        if (document.visibilityState === "visible" && this.leases.size > 0 && !this.isOpen()) {
          this.open();
        }
      };
      document.addEventListener("visibilitychange", this.visibilityListener);
    }
    this.open();
  }

  release(leaseId: number): void {
    this.leases.delete(leaseId);
    this.listeners.delete(leaseId);
    this.stateListeners.delete(leaseId);
    for (const [conversationId, owners] of this.subscriptions) {
      owners.delete(leaseId);
      if (!owners.size) {
        this.subscriptions.delete(conversationId);
        this.send({ type: "unsubscribe", conversation_id: conversationId });
      }
    }
    if (this.leases.size === 0) this.stop();
  }

  subscribe(conversationId: string, leaseId: number): () => void {
    if (!conversationId) return () => {};
    const owners = this.subscriptions.get(conversationId) ?? new Set<number>();
    const wasEmpty = owners.size === 0;
    owners.add(leaseId);
    this.subscriptions.set(conversationId, owners);
    if (wasEmpty) this.send({ type: "subscribe", conversation_id: conversationId });
    return () => {
      const current = this.subscriptions.get(conversationId);
      if (!current) return;
      current.delete(leaseId);
      if (!current.size) {
        this.subscriptions.delete(conversationId);
        this.send({ type: "unsubscribe", conversation_id: conversationId });
      }
    };
  }

  typing(conversationId: string, isTyping: boolean): void {
    if (!conversationId) return;
    if (!isTyping) {
      this.typingLastSentAt.delete(conversationId);
      this.send({ type: "typing", conversation_id: conversationId, is_typing: false });
      return;
    }
    const now = Date.now();
    const lastSentAt = this.typingLastSentAt.get(conversationId) ?? 0;
    if (now - lastSentAt < TYPING_THROTTLE_MS) return;
    if (this.send({ type: "typing", conversation_id: conversationId, is_typing: true })) {
      this.typingLastSentAt.set(conversationId, now);
    }
  }

  private currentState(): RealtimeConnectionState {
    if (this.socket?.readyState === WebSocket.OPEN) return "connected";
    if (this.socket?.readyState === WebSocket.CONNECTING) return this.hasConnected ? "reconnecting" : "connecting";
    return this.leases.size ? (this.hasConnected ? "reconnecting" : "idle") : "idle";
  }

  private isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING;
  }

  private notifyState(state: RealtimeConnectionState, reconnected = false): void {
    for (const listener of this.stateListeners.values()) listener(state, reconnected);
  }

  private open(): void {
    if (this.manualClose || this.leases.size === 0 || this.isOpen()) return;
    if (typeof WebSocket === "undefined") {
      this.notifyState("unavailable");
      return;
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.notifyState(this.hasConnected ? "reconnecting" : "connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(realtimeUrl(), [SOCKET_SUBPROTOCOL, this.accessToken]);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      const reconnected = this.hasConnected;
      this.hasConnected = true;
      this.reconnectAttempt = 0;
      this.notifyState("connected", reconnected);
      for (const conversationId of this.subscriptions.keys()) {
        this.send({ type: "subscribe", conversation_id: conversationId });
      }
      // The authenticated server handshake sends the canonical `connected`
      // event. Synthesising a second one here made every consumer reconcile
      // twice for one socket connection (and doubled their HTTP fallback
      // reads). Wait for the server frame so "connected" also means the
      // protocol handshake, not merely that the TCP/WebSocket transport opened.
    };
    socket.onmessage = (message) => {
      let parsed: RealtimeMessagingEvent | null = null;
      try {
        parsed = asRealtimeEvent(JSON.parse(String(message.data)));
      } catch {
        return;
      }
      if (!parsed) return;
      if (this.seenEventIds.has(parsed.event_id)) return;
      this.seenEventIds.add(parsed.event_id);
      if (this.seenEventIds.size > MAX_EVENT_IDS) {
        const oldest = this.seenEventIds.values().next().value;
        if (oldest) this.seenEventIds.delete(oldest);
      }
      for (const listener of this.listeners.values()) listener(parsed);
    };
    socket.onerror = () => {
      // `close` is the single reconnection path; browser error events carry no
      // useful details and must not create a visible developer-style warning.
    };
    socket.onclose = (event) => {
      if (this.socket === socket) this.socket = null;
      // Authorization failures are not a transient network condition. A new
      // browser session (or persona token) will create a new client; retrying
      // this one would only create an avoidable reconnect loop.
      if (event.code === 4401 || event.code === 4403) {
        this.manualClose = true;
        this.notifyState("unavailable");
        return;
      }
      if (!this.manualClose && this.leases.size > 0) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.manualClose || this.leases.size === 0 || this.reconnectTimer !== null) return;
    this.notifyState(this.hasConnected ? "reconnecting" : "unavailable");
    const delay = Math.min(500 * 2 ** this.reconnectAttempt, MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private send(payload: Record<string, unknown>): boolean {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  private stop(): void {
    this.manualClose = true;
    this.typingLastSentAt.clear();
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.visibilityListener) {
      document.removeEventListener("visibilitychange", this.visibilityListener);
      this.visibilityListener = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "session-ended");
  }

  forceClose(): void {
    this.leases.clear();
    this.listeners.clear();
    this.stateListeners.clear();
    this.subscriptions.clear();
    this.typingLastSentAt.clear();
    this.stop();
  }
}

let activeClient: { key: string; client: RealtimeMessagingClient } | null = null;

function acquireClient(accessToken: string, backendUserId: string): RealtimeMessagingClient {
  const key = `${backendUserId}:${accessToken}`;
  if (!activeClient || activeClient.key !== key) {
    // A new backend identity is a hard session boundary. This closes old persona
    // sockets before their events can be delivered into the new identity.
    if (activeClient) activeClient.client.forceClose();
    activeClient = { key, client: new RealtimeMessagingClient(accessToken, backendUserId) };
  }
  return activeClient.client;
}

export function useRealtimeMessaging({
  enabled,
  accessToken,
  backendUserId,
  onEvent,
}: {
  enabled: boolean;
  accessToken?: string | null;
  backendUserId?: string | null;
  onEvent: (event: RealtimeMessagingEvent) => void;
}) {
  const leaseIdRef = useRef<number | null>(null);
  if (leaseIdRef.current === null) leaseIdRef.current = nextLeaseId++;
  const clientRef = useRef<RealtimeMessagingClient | null>(null);
  const onEventRef = useRef(onEvent);
  const [state, setState] = useState<RealtimeConnectionState>("idle");

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled || !accessToken || !backendUserId) {
      clientRef.current = null;
      setState("idle");
      return;
    }
    const client = acquireClient(accessToken, backendUserId);
    clientRef.current = client;
    const leaseId = leaseIdRef.current as number;
    client.acquire(leaseId, (event) => onEventRef.current(event), (next) => setState(next));
    return () => {
      client.release(leaseId);
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [enabled, accessToken, backendUserId]);

  const subscribeConversation = useCallback((conversationId: string) => {
    const client = clientRef.current;
    if (!client) return () => {};
    return client.subscribe(conversationId, leaseIdRef.current as number);
  }, []);

  const sendTyping = useCallback((conversationId: string, isTyping: boolean) => {
    clientRef.current?.typing(conversationId, isTyping);
  }, []);

  return { state, subscribeConversation, sendTyping };
}

export function __resetRealtimeMessagingForTests(): void {
  activeClient = null;
}
