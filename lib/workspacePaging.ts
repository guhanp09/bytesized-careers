/**
 * How much of a list the workspace actually puts in the DOM.
 *
 * The workspace received every record it had and rendered all of them. At the
 * volumes the product is built for that was fine; at 329 relationships it meant
 * 329 rows and 23,000 nodes on first paint, and a job carrying 214 applicants
 * rendered 214 cards into one stage.
 *
 * The fix is deliberately *not* virtualisation. Windowing a scroll container
 * buys smoother scrolling at the cost of breaking find-in-page, anchor links,
 * printing and most screen-reader list semantics — a bad trade for a hiring
 * inbox someone reads a page at a time. What this does instead is render a
 * bounded page and give the reader an explicit control to render more.
 *
 * The important property is that **only rendering is bounded**. Counts, filters,
 * queues, search and selection all keep operating on the complete set, so a
 * total never becomes "the total of what happens to be on screen". Those are two
 * different numbers and the UI has to be able to say both.
 *
 * The shape mirrors the pagination contract the rest of the API already uses —
 * `{ items, total, limit, offset }` on `/jobs` and `/talent-listings` — so when
 * `/me/activity/summary` grows a server-side page, the seam is already the right
 * shape and the components do not change. Today that endpoint returns the whole
 * set to both Backend and Mock mode, which is why the boundary sits here.
 */

/** Conversations rendered before the reader asks for more. */
export const INBOX_PAGE_SIZE = 40;

/** Cards rendered per stage on the full board. */
export const PIPELINE_STAGE_PAGE_SIZE = 12;

/**
 * Cards rendered when a single stage is focused.
 *
 * Higher, because focusing a stage is a request to look at that stage — but
 * still bounded, because "the user asked for it" is how 214 cards ended up in
 * the DOM in the first place.
 */
export const PIPELINE_FOCUSED_PAGE_SIZE = 40;

export type BoundedPage<T> = {
  /** The slice actually rendered. */
  rendered: T[];
  /** How many records match, in full. Never the length of `rendered`. */
  total: number;
  /** How many are not rendered yet. */
  remaining: number;
  hasMore: boolean;
  /** The window size in force, after any expansion. */
  limit: number;
};

/**
 * The first `limit` records, plus whatever it takes to reach `mustInclude`.
 *
 * A record can be selected without being on the first page — a notification deep
 * link, or the conversation someone left open three days ago. Hiding its row
 * while its conversation fills the detail pane reads as a bug, so the window
 * grows to the page boundary containing it rather than pinning it out of order.
 * Ordering is what makes a list scannable; a row teleported to the top to keep a
 * count small is worse than a longer list.
 *
 * `pageSize` is used for the boundary so expansion lands on a round number
 * rather than stopping exactly at the selected row, which would make the very
 * next "load more" render a single extra item.
 */
export function boundedPage<T>(
  all: readonly T[],
  limit: number,
  options: { mustInclude?: (item: T) => boolean; pageSize?: number } = {}
): BoundedPage<T> {
  const total = all.length;
  const pageSize = Math.max(1, options.pageSize ?? limit);
  let effective = Math.max(0, limit);

  if (options.mustInclude) {
    // The *last* match, not the first: several records can need to stay
    // rendered at once — a bulk selection, or a set of cards just moved into a
    // stage — and stopping at the first would silently drop the rest.
    let furthest = -1;
    for (let index = all.length - 1; index >= effective; index -= 1) {
      if (options.mustInclude(all[index])) {
        furthest = index;
        break;
      }
    }
    if (furthest >= effective) {
      effective = Math.ceil((furthest + 1) / pageSize) * pageSize;
    }
  }

  const rendered = effective >= total ? all.slice() : all.slice(0, effective);
  return {
    rendered,
    total,
    remaining: Math.max(0, total - rendered.length),
    hasMore: rendered.length < total,
    limit: effective,
  };
}

/**
 * The next window size.
 *
 * Adding a fixed step rather than doubling: doubling reaches "everything" in a
 * few taps, which is the behaviour this exists to prevent, and it makes each
 * press cost an unpredictable amount.
 */
export function nextLimit(current: number, step: number, total: number): number {
  return Math.min(total, current + Math.max(1, step));
}

/**
 * What the "load more" control says.
 *
 * Names the number the reader is about to add, not the number remaining, so the
 * cost of pressing it is legible. The remaining count is carried separately for
 * the status line.
 */
export function loadMoreLabel(page: { remaining: number }, step: number, noun: string): string {
  const next = Math.min(page.remaining, Math.max(1, step));
  return `Load ${next} more ${next === 1 ? noun : `${noun}s`}`;
}

/**
 * The restrained announcement a screen reader gets after loading.
 *
 * Past tense and specific: "loading…" on a control that has already finished is
 * noise, and "more items" does not tell someone whether pressing it worked.
 */
export function loadedAnnouncement(added: number, shown: number, total: number, noun: string): string {
  return `${added} more ${added === 1 ? noun : `${noun}s`} loaded. Showing ${shown} of ${total}.`;
}

/** "Showing 40 of 329" — the two numbers that must never be conflated. */
export function showingLabel(page: { rendered: unknown[]; total: number }, noun: string): string {
  return `Showing ${page.rendered.length} of ${page.total} ${page.total === 1 ? noun : `${noun}s`}`;
}
