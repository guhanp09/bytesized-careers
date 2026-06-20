/**
 * Pure helper for interpreting a /drafts load. Kept dependency-free so it can be
 * unit-tested directly and reasoned about in isolation.
 */

export type DraftLoadOutcome<J, T> =
  | { kind: "auth" }
  | { kind: "error" }
  | { kind: "ready"; jobs: J[]; listings: T[] };

/**
 * Decide what a /drafts load means from the two settled list requests.
 *
 * The key fix: an expired/invalid session (401) must NOT be silently treated as
 * "zero drafts" — that renders a false "No drafts yet." empty state for users who
 * actually have drafts. So an auth failure on either request returns "auth", a
 * total failure returns "error", and only genuinely successful (possibly empty)
 * responses return "ready". A single non-auth failure still degrades gracefully.
 */
export function classifyDraftLoad<J, T>(
  jobResult: PromiseSettledResult<J[]>,
  talentResult: PromiseSettledResult<T[]>,
  isAuthError: (error: unknown) => boolean
): DraftLoadOutcome<J, T> {
  const rejected = [jobResult, talentResult].filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (rejected.some((result) => isAuthError(result.reason))) return { kind: "auth" };
  if (rejected.length === 2) return { kind: "error" };
  return {
    kind: "ready",
    jobs: jobResult.status === "fulfilled" ? jobResult.value : [],
    listings: talentResult.status === "fulfilled" ? talentResult.value : [],
  };
}
