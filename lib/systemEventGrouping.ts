/**
 * Collapsing consecutive system events in a conversation.
 *
 * The right-hand Timeline is the complete authoritative history. The thread was
 * rendering the same events again as a chip per event, so a conversation with
 * one human message and seven status updates read as seven pieces of system
 * chrome and one sentence — the machine talking over the people.
 *
 * This groups only *consecutive* runs. Merging across a human message would
 * misrepresent when things happened relative to what was said, which is the one
 * thing the thread ordering exists to convey.
 */

export type GroupableMessage = {
  id: string;
  kind?: string;
  body: string;
  createdAt?: string | null;
};

export type ThreadEntry<T extends GroupableMessage> =
  | { type: "message"; message: T }
  | {
      type: "system-group";
      id: string;
      /** Every event in the run, in order, for the expanded view. */
      events: T[];
      /** The collapsed line. Describes the run rather than counting it blindly. */
      summary: string;
      /** ISO instant of the most recent event in the run. */
      latestAt: string | null;
    };

/**
 * Words that identify what a run of events was *about*.
 *
 * "3 application updates" is more useful than "3 system events", and
 * "Interview and status updated" is more useful still. The classification is
 * deliberately shallow — it reads the platform's own message bodies, which are
 * generated from a fixed vocabulary, so it degrades to the generic phrasing
 * rather than guessing when it sees something unfamiliar.
 */
const TOPICS: Array<{ key: string; noun: string; test: RegExp }> = [
  { key: "interview", noun: "interview", test: /\binterview\b/i },
  { key: "engagement", noun: "engagement", test: /\b(start|engagement|work began|completion)\b/i },
  { key: "payment", noun: "payment", test: /\b(payment|escrow|funds?|invoice|released?)\b/i },
  { key: "application", noun: "application", test: /\b(applied|application|shortlist|under consideration|not selected|hired|reviewing|withdrew|withdrawn)\b/i },
];

function classify(body: string): string | null {
  for (const topic of TOPICS) {
    if (topic.test.test(body)) return topic.key;
  }
  return null;
}

const NOUN_BY_KEY = Object.fromEntries(TOPICS.map((topic) => [topic.key, topic.noun]));

/**
 * Describe a run of system events.
 *
 * One event shows its own text — collapsing a single line behind a disclosure
 * would hide information while claiming to summarise it. Several events of one
 * kind are counted by that kind; a mixed run names the kinds involved.
 */
export function summarizeSystemEvents(events: GroupableMessage[]): string {
  if (events.length === 0) return "";
  if (events.length === 1) return events[0].body;

  const topics = Array.from(
    new Set(events.map((event) => classify(event.body)).filter((key): key is string => Boolean(key)))
  );

  if (topics.length === 1) {
    const noun = NOUN_BY_KEY[topics[0]];
    return `${events.length} ${noun} update${events.length === 1 ? "" : "s"}`;
  }
  if (topics.length === 2) {
    const [first, second] = topics.map((key) => NOUN_BY_KEY[key]);
    return `${first[0].toUpperCase()}${first.slice(1)} and ${second} updated`;
  }
  // Three or more distinct topics, or none recognised: count them plainly
  // rather than inventing a description the events do not support.
  return `${events.length} updates`;
}

/**
 * Fold a conversation into renderable entries.
 *
 * Runs of one are *not* grouped: a lone status line is already as compact as a
 * disclosure would be, and hiding it behind a control would cost a click for
 * nothing.
 */
export function groupThreadEntries<T extends GroupableMessage>(messages: T[]): ThreadEntry<T>[] {
  const entries: ThreadEntry<T>[] = [];
  let run: T[] = [];

  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      entries.push({ type: "message", message: run[0] });
    } else {
      const latest = run.reduce<string | null>(
        (newest, event) =>
          event.createdAt && (!newest || Date.parse(event.createdAt) > Date.parse(newest))
            ? event.createdAt
            : newest,
        null
      );
      entries.push({
        type: "system-group",
        id: `system-group-${run[0].id}`,
        events: [...run],
        summary: summarizeSystemEvents(run),
        latestAt: latest,
      });
    }
    run = [];
  };

  for (const message of messages) {
    if (message.kind === "status") {
      run.push(message);
      continue;
    }
    // A human message ends the run: grouping across it would claim the events
    // happened together when the conversation says otherwise.
    flush();
    entries.push({ type: "message", message });
  }
  flush();
  return entries;
}
