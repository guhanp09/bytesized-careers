// Frequency-capping for the home job-alerts popup. Keeps it persuasive but not
// nagging: it never interrupts someone who's subscribed, appears at most once per
// browser session, and after a dismissal snoozes for a week (a month after two),
// giving up entirely after three dismissals. All state is local (no backend).

const STORAGE_KEY = "cj.jobalerts.popup";
const SESSION_SHOWN_KEY = "cj.jobalerts.popup.shown";

const DAY_MS = 24 * 60 * 60 * 1000;
const SNOOZE_DAYS = 7; // after a dismissal
const SNOOZE_DAYS_REPEAT = 30; // after the second dismissal
const MAX_DISMISSALS = 3; // give up after this many

type PopupState = {
  subscribed?: boolean;
  snoozedUntil?: number;
  dismissCount?: number;
};

function readState(): PopupState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as PopupState) : {};
  } catch {
    return {};
  }
}

function writeState(patch: PopupState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readState(), ...patch }));
  } catch {
    // storage unavailable (private mode); the popup simply won't persist state
  }
}

/** Remember the user subscribed (via the popup or the inline section). */
export function markJobAlertsSubscribed(): void {
  writeState({ subscribed: true });
}

/** Record a dismissal: bump the count and snooze the popup for a while. */
export function markJobAlertsDismissed(): void {
  const { dismissCount = 0 } = readState();
  const nextCount = dismissCount + 1;
  const days = nextCount >= 2 ? SNOOZE_DAYS_REPEAT : SNOOZE_DAYS;
  writeState({ dismissCount: nextCount, snoozedUntil: Date.now() + days * DAY_MS });
}

/** Mark that the popup has been shown once in this browser session. */
export function markJobAlertsShownThisSession(): void {
  try {
    window.sessionStorage.setItem(SESSION_SHOWN_KEY, "1");
  } catch {
    // ignore
  }
}

function shownThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_SHOWN_KEY) === "1";
  } catch {
    return false;
  }
}

/** Whether the popup may show right now given all the caps above. */
export function isJobAlertsPopupEligible(): boolean {
  if (typeof window === "undefined") return false;
  if (shownThisSession()) return false;
  const state = readState();
  if (state.subscribed) return false;
  if ((state.dismissCount ?? 0) >= MAX_DISMISSALS) return false;
  if (state.snoozedUntil && Date.now() < state.snoozedUntil) return false;
  return true;
}
