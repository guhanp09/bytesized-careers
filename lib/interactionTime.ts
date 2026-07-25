/**
 * One rule for every timestamp the workspace renders.
 *
 * The inbox used to mix `6 Jan 2026`, `6d ago`, `3h ago` and `1m ago` in a
 * single column. That was not a formatting bug — there was no formatting at
 * render time at all. Both data paths stored *display strings*: the Mock
 * fixture hand-typed them, and the backend mapper called the formatter once at
 * map time and threw the ISO instant away. A frozen label cannot refresh, and a
 * discarded instant cannot be shown in full on hover.
 *
 * So the model is: records carry authoritative instants, and formatting happens
 * where and when the text is drawn.
 */

/** Anything a caller might hand us for a point in time. */
export type TimeInput = string | number | Date | null | undefined;

/**
 * Parse to epoch milliseconds, or null when there is nothing usable.
 *
 * Backend timestamps are UTC but some arrive without a timezone designator;
 * parsing those as local time shifts every label by the reader's UTC offset.
 * Normalising centrally is the point — the previous code did this inside the
 * formatter, so any other consumer of the same field got it wrong.
 */
export function parseInstant(value: TimeInput): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const time = Date.parse(hasZone ? value : `${value}Z`);
  return Number.isFinite(time) ? time : null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Below this age a timestamp reads as an interval; above it, as a date. */
export const RELATIVE_WINDOW_DAYS = 7;

/**
 * The concise label: relative under seven days, `12 Mar` later in the same
 * year, `12 Mar 2025` beyond it.
 *
 * `now` is a parameter rather than a call to `Date.now()` so the rule is
 * testable at every boundary and so the shared ticker can drive re-renders from
 * one clock instead of each component reading its own.
 */
export function formatInteractionTime(value: TimeInput, now: number = Date.now()): string {
  const time = parseInstant(value);
  if (time === null) return "";

  const delta = now - time;

  // Scheduled interviews are legitimately in the future. "in 2 days" is the
  // honest reading; "0m ago" is not.
  if (delta < -MINUTE) {
    const ahead = -delta;
    if (ahead < HOUR) return `in ${Math.round(ahead / MINUTE)}m`;
    if (ahead < DAY) return `in ${Math.round(ahead / HOUR)}h`;
    if (ahead < RELATIVE_WINDOW_DAYS * DAY) return `in ${Math.round(ahead / DAY)}d`;
    return absoluteDateLabel(time, now);
  }

  const minutes = Math.floor(Math.max(0, delta) / MINUTE);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < RELATIVE_WINDOW_DAYS) return `${days}d ago`;
  return absoluteDateLabel(time, now);
}

/** `12 Mar` inside the reference year, `12 Mar 2025` outside it. */
function absoluteDateLabel(time: number, now: number): string {
  const when = new Date(time);
  const sameYear = when.getFullYear() === new Date(now).getFullYear();
  return when.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/**
 * The full instant, for the reader who needs to know exactly when.
 *
 * Rendered into the accessible name and the tooltip rather than being hidden
 * behind a pointer-only `title`, so keyboard and screen-reader users get the
 * same information.
 */
export function formatAbsoluteTime(value: TimeInput): string {
  const time = parseInstant(value);
  if (time === null) return "";
  return new Date(time).toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The `datetime` attribute value: a machine-readable ISO instant. */
export function toDateTimeAttribute(value: TimeInput): string | undefined {
  const time = parseInstant(value);
  return time === null ? undefined : new Date(time).toISOString();
}

/**
 * What a screen reader announces: the concise reading first, because that is
 * what sighted users see, then the full instant.
 */
export function describeInteractionTime(value: TimeInput, now: number = Date.now()): string {
  const concise = formatInteractionTime(value, now);
  const absolute = formatAbsoluteTime(value);
  if (!concise) return "";
  return absolute ? `${concise} — ${absolute}` : concise;
}

/**
 * How long until this label could change, in ms — or null when it never will.
 *
 * Absolute dates are stable, so a list of month-old threads schedules no work
 * at all. This is what lets one shared ticker stay cheap.
 */
export function nextRefreshDelay(value: TimeInput, now: number = Date.now()): number | null {
  const time = parseInstant(value);
  if (time === null) return null;
  const delta = Math.abs(now - time);
  if (delta >= RELATIVE_WINDOW_DAYS * DAY) return null;
  if (delta < HOUR) return MINUTE;
  if (delta < DAY) return HOUR;
  return DAY;
}
