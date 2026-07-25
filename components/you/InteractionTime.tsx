"use client";

import { useSyncExternalStore } from "react";

import {
  describeInteractionTime,
  formatAbsoluteTime,
  formatInteractionTime,
  nextRefreshDelay,
  toDateTimeAttribute,
  type TimeInput,
} from "../../lib/interactionTime";

/**
 * One shared clock for every visible relative timestamp.
 *
 * A timer per timestamp would mean forty timers in a full inbox, all firing on
 * their own schedules. Instead there is one interval, and components subscribe
 * to it. It ticks once a minute — the finest granularity any label here has —
 * and only while the document is visible, because nothing needs to re-render
 * "3m ago" into "4m ago" in a background tab.
 *
 * Deliberately a module-level store rather than context or a state library: it
 * has no props, no provider to forget, and no place in the component tree.
 */
const TICK_MS = 60_000;

const listeners = new Set<() => void>();
let currentTick = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function emit() {
  currentTick = Date.now();
  for (const listener of listeners) listener();
}

function start() {
  if (timer !== null || typeof document === "undefined") return;
  timer = setInterval(() => {
    if (document.visibilityState === "visible") emit();
  }, TICK_MS);
}

function stop() {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

function onVisibilityChange() {
  // Returning to the tab may reveal a label that is minutes stale, so catch up
  // once immediately rather than waiting out the next interval.
  if (document.visibilityState === "visible") emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    start();
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };
}

/**
 * The current minute, shared by every timestamp on the page.
 *
 * The server snapshot is a fixed 0 so the first client render matches the
 * markup React produced on the server; the first tick then corrects it. Reading
 * `Date.now()` during render would be a hydration mismatch on every timestamp.
 */
function useSharedNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => {
      // First client read seeds the clock, so render never calls Date.now()
      // itself and every timestamp on the page shares one instant.
      if (currentTick === 0) currentTick = Date.now();
      return currentTick;
    },
    () => 0
  );
}

/**
 * A timestamp: concise text, a machine-readable instant, and the full date and
 * time available to pointer, keyboard and assistive technology alike.
 *
 * Not a tab stop. Making every timestamp focusable would add forty stops to an
 * inbox for information that is already in the accessible name — so the full
 * instant travels in `aria-label` and `title`, and the element stays out of the
 * tab order.
 */
export function InteractionTime({
  value,
  className,
  prefix,
  testId,
}: {
  value: TimeInput;
  className?: string;
  /** Rendered before the label, inside the same element (e.g. "· "). */
  prefix?: string;
  testId?: string;
}) {
  // 0 during the server render, a real instant from the first client read.
  // `suppressHydrationWarning` covers the one frame where the two differ.
  const now = useSharedNow();

  const dateTime = toDateTimeAttribute(value);
  if (!dateTime) {
    // Missing or unparseable: render nothing rather than "Invalid Date".
    return null;
  }

  // With no clock yet (server render) the concise label would be meaningless,
  // so fall back to the absolute form until the client takes over.
  const label = now > 0 ? formatInteractionTime(value, now) : formatAbsoluteTime(value);
  const absolute = formatAbsoluteTime(value);

  return (
    <time
      dateTime={dateTime}
      title={absolute}
      aria-label={now > 0 ? describeInteractionTime(value, now) : absolute}
      data-testid={testId}
      className={className}
      suppressHydrationWarning
    >
      {prefix}
      {label}
    </time>
  );
}

export { nextRefreshDelay };
