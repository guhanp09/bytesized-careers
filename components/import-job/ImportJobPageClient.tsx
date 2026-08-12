"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import {
  BackendRequestError,
  describeActionError,
  isBackendUnreachableError,
  listRoles,
  type BackendRole,
} from "../../lib/backendClient";
import { trackJobImportEvent } from "../../lib/jobImportAnalytics";
import {
  applyJobImportDraft,
  createDevelopmentJobImportFixture,
  createJobImportSource,
  createJobImportUrlSource,
  getJobImportDraft,
  getJobImportSource,
  answerJobImportQuestion,
  beginJobImportConversation,
  continueJobImportManually,
  getJobImportConversation,
  skipJobImportQuestion,
  initializeJobImportDraft,
  pauseJobImportConversation,
  processJobImportDraft,
  setJobImportPrefill,
  type JobImportConversation,
  type JobImportDraft,
  type JobImportNonNullJsonValue,
  type JobImportSource,
  type DevelopmentJobImportScenario,
} from "../../lib/jobImportReadiness";
import { normalizeImportText } from "../../lib/importJob/normalize";
import {
  OPENABLE_STATUSES,
  backendHasSettled,
  settlementFor,
} from "../../lib/importJob/settlement";
import { PageHeader, PageLoading, StateCard } from "../ui";
import { Icon } from "../Icons";
import PastePanel from "./PastePanel";
import { DraftAssistantCanvas } from "./assistant/DraftAssistantCanvas";
import { DraftAssistantRobot } from "./assistant/DraftAssistantRobot";
import RecruiterJobPreview from "../post-job/RecruiterJobPreview";
import {
  importPreviewProps,
  importPreviewRoleName,
  importPreviewSnapshot,
} from "../../lib/jobImportPreview";
import {
  importGhostButton,
  importInputBase,
  importPanelClass,
  importPrimaryButton,
} from "./importPrimitives";

type Phase = "entry" | "creating" | "processing" | "applying" | "failure";
type EntryMode = "text" | "url";

const isDevelopmentRuntime =
  process.env.NODE_ENV === "development" ||
  ["development", "test"].includes(process.env.NEXT_PUBLIC_APP_ENV ?? "");

// Derived, not restated. Two hand-written copies of "which statuses mean the
// draft can be opened" is exactly the drift that lets one of them fall behind.
const terminalDraftStatuses = new Set<string>(OPENABLE_STATUSES);

function setDraftLocation(draftId: string | null) {
  const next = new URL(window.location.href);
  if (draftId) next.searchParams.set("draft", draftId);
  else next.searchParams.delete("draft");
  // Pass a fresh public state value through Next's patched history API. The
  // patch copies its private router state and updates the canonical URL; passing
  // `window.history.state` bypasses that integration and Next restores the old
  // URL on its next update, silently dropping the draft id.
  window.history.replaceState(
    null,
    "",
    `${next.pathname}${next.search}${next.hash}`
  );
}

function readableImportError(error: unknown, sourceType: EntryMode): string {
  const code = error instanceof BackendRequestError ? error.code ?? "" : "";
  // The server now distinguishes *why* a page could not be imported — a board
  // index, a bot check, a shell — and writes recruiter-facing wording for each.
  // Collapsing them here told someone whose URL listed thirty jobs that we
  // "couldn't read the page safely", which is both wrong and unactionable.
  // Pasted text is classified on the server too — three roles pasted together
  // are not one job — and the same rule applies to its wording: the server
  // writes the sentence because only the server knows which case it is.
  const RECOVERABLE_URL_CODES = new Set([
    "JOB_IMPORT_URL_MULTIPLE_JOBS",
    "JOB_IMPORT_URL_NO_JOB_CONTENT",
    "JOB_IMPORT_URL_ACCESS_DECLINED",
    "JOB_IMPORT_TEXT_MULTIPLE_JOBS",
    "JOB_IMPORT_TEXT_NO_JOB_CONTENT",
  ]);
  if (RECOVERABLE_URL_CODES.has(code)) {
    const detail = error instanceof BackendRequestError ? error.message?.trim() : "";
    if (detail) return detail;
  }
  if (code === "JOB_IMPORT_URL_AUTH_REQUIRED") {
    return "This page blocks automated access. Paste the job text instead.";
  }
  if (
    code.startsWith("JOB_IMPORT_URL_") &&
    code !== "JOB_IMPORT_URL_TIMEOUT" &&
    code !== "JOB_IMPORT_URL_FETCH_FAILED"
  ) {
    return "We couldn’t read that page safely. Check that it is a public job page, or paste the job text instead.";
  }
  if (code === "JOB_IMPORT_URL_TIMEOUT" || code === "JOB_IMPORT_URL_FETCH_FAILED") {
    return "That page did not respond in time. Try again, or paste the job text instead.";
  }
  if (/api key|configuration|configured/i.test(String((error as Error)?.message ?? ""))) {
    return "Draft preparation is temporarily unavailable. Your source remains private; try again later.";
  }
  if (isBackendUnreachableError(error)) {
    return describeActionError(error);
  }
  // Import failures never render the backend's own prose. Those messages are
  // written for operators and have carried implementation detail into the
  // recruiter's view; the code is enough to choose copy they can act on.
  return sourceType === "url"
    ? "We couldn’t prepare a draft from that page. Try again or paste the job text."
    : "We couldn’t prepare a draft from that text. Try again or continue manually.";
}

function importCounts(draft: JobImportDraft) {
  return draft.fields.reduce(
    (counts, field) => {
      if (field.decision_origin === "explicit") counts.explicitCount += 1;
      if (
        field.decision_origin === "contextual_inference" ||
        field.decision_origin === "semantic_inference"
      ) {
        counts.inferredCount += 1;
      }
      if (field.decision_origin === "suggestion") counts.suggestedCount += 1;
      if (field.needs_review) counts.reviewCount += 1;
      if (field.provenance_state === "missing") counts.missingCount += 1;
      return counts;
    },
    {
      explicitCount: 0,
      inferredCount: 0,
      suggestedCount: 0,
      reviewCount: 0,
      missingCount: 0,
    }
  );
}

/** What a genuine processing failure says.
 *
 * Plain about what happened, and it names the ways forward rather than leaving
 * the recruiter to guess. It deliberately does not blame the source or the
 * recruiter: nothing they did caused it, and nothing they retype would fix it.
 */
const FAILURE_MESSAGE =
  "We couldn’t finish reading this page. Nothing you entered was lost — retry, paste the job text instead, or continue manually.";

/**
 * The draft being waited on stopped existing while the screen waited on it.
 *
 * Discarded elsewhere, or replaced by a newer import of the same source. There
 * is no failure to report and nothing to retry into, so this says what happened
 * and offers the one action that still makes sense.
 */
const SUPERSEDED_MESSAGE =
  "This import was replaced by a newer one. Start it again, or paste the job text to carry on here.";

export default function ImportJobPageClient() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const [phase, setPhase] = React.useState<Phase>("entry");
  //: Bumped when a status read fails, so the reader below re-arms itself.
  const [pollTick, setPollTick] = React.useState(0);
  const [entryMode, setEntryMode] = React.useState<EntryMode>("text");
  const [text, setText] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [truncated, setTruncated] = React.useState(false);
  const [draft, setDraft] = React.useState<JobImportDraft | null>(null);
  const [source, setSource] = React.useState<JobImportSource | null>(null);
  const [error, setError] = React.useState("");
  const [delayed, setDelayed] = React.useState(false);
  /** True once the wait has outlasted a single provider attempt. */
  const [retrying, setRetrying] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState("");
  const [developmentScenario, setDevelopmentScenario] =
    React.useState<DevelopmentJobImportScenario>("strong-decisions");
  const [lastDevelopmentScenario, setLastDevelopmentScenario] =
    React.useState<DevelopmentJobImportScenario | null>(null);
  const [answeringEarlyQuestion, setAnsweringEarlyQuestion] = React.useState(false);
  const [conversation, setConversation] = React.useState<JobImportConversation | null>(
    null
  );
  const [roleCatalog, setRoleCatalog] = React.useState<BackendRole[]>([]);
  const accessToken = session?.backendAccessToken ?? "";
  const restoredRef = React.useRef(false);
  const processingRef = React.useRef(false);
  const finishingRef = React.useRef(false);
  const requestControllerRef = React.useRef<AbortController | null>(null);
  const requestIdRef = React.useRef<string | null>(null);
  const startedAtRef = React.useRef(0);
  const answeringRef = React.useRef(false);
  const pauseConversationRef = React.useRef<Promise<JobImportConversation> | null>(
    null
  );
  const readbackPendingRef = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    void listRoles()
      .then((response) => {
        if (!cancelled) setRoleCatalog(response.items);
      })
      .catch(() => {
        // Role labels improve the live preview, but a temporary catalog failure
        // must never block importing or discard a stable role key.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!["creating", "processing"].includes(phase)) {
      setDelayed(false);
      setRetrying(false);
      return;
    }
    const timer = window.setTimeout(() => setDelayed(true), 8_000);
    // A first attempt can run to 90 seconds, and one transient retry can follow
    // it. Past the first ceiling the honest thing to say is that this is taking
    // longer than usual and the source is being read again — not to keep
    // repeating the eight-second message as though nothing had changed, and not
    // to imply anything finished.
    const secondAttempt = window.setTimeout(() => setRetrying(true), 95_000);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(secondAttempt);
    };
  }, [phase]);

  const openCanonicalDraft = React.useCallback(
    async (readyDraft: JobImportDraft) => {
      if (!accessToken || finishingRef.current) return;
      if (readyDraft.target_job_id) {
        router.replace(
          `/post-job?draftId=${encodeURIComponent(readyDraft.target_job_id)}&imported=1`
        );
        return;
      }
      // Extraction finishing is not the end of the conversation. The assistant
      // asks every question it identified — essential first, then the few
      // improvements worth offering — inside this canvas, and only hands off
      // once it says it is done.
      //
      // The gate is the assistant's own completion rule, never
      // can_apply_to_native_draft: a private draft can exist almost from the
      // start, so using that would hand the recruiter off mid-conversation.
      try {
        const opened = await beginJobImportConversation(accessToken, readyDraft.id);
        setConversation(opened);
        if (!opened.ready_for_draft) {
          setDraft(readyDraft);
          setPhase("processing");
          setAnnouncement(
            opened.phase === "optional"
              ? "The core draft is ready. I have a couple of optional suggestions."
              : "I have a few questions before your draft is ready."
          );
          return;
        }
        // Completion is a message and a choice, not an automatic navigation.
        // Keep the recruiter in the conversation so they can see what was
        // prepared, then let the explicit "Open job draft" action perform the
        // native conversion below through `openNativeDraft`.
        setDraft(readyDraft);
        setPhase("processing");
        setAnnouncement("Your private draft is ready to review.");
        return;
      } catch {
        // The conversation is additive; without it the ordinary handoff stands.
      }

      if (!readyDraft.can_apply_to_native_draft) {
        setDraft(readyDraft);
        setAnnouncement("I prepared the details I could verify. The normal Post Job draft will ask for the remaining decision.");
        router.replace(`/post-job?importDraftId=${encodeURIComponent(readyDraft.id)}`);
        return;
      }
      finishingRef.current = true;
      setPhase("applying");
      setAnnouncement("Preparing your Post Job draft.");
      try {
        const result = await applyJobImportDraft(accessToken, readyDraft.id);
        setDraft(result.draft);
        trackJobImportEvent("job_import.completed", {
          sourceType: entryMode,
          durationMs: Math.max(0, Date.now() - startedAtRef.current),
          ...importCounts(result.draft),
        });
        router.replace(
          `/post-job?draftId=${encodeURIComponent(String(result.job.id))}&imported=1`
        );
      } catch {
        // Same rule as the explicit handoff: a failed conversion is not the end
        // of the import. The editor hydrates from the import draft directly, so
        // the recruiter continues with everything they supplied.
        trackJobImportEvent("job_import.completed", {
          sourceType: entryMode,
          durationMs: Math.max(0, Date.now() - startedAtRef.current),
        });
        router.replace(`/post-job?importDraftId=${encodeURIComponent(readyDraft.id)}`);
      } finally {
        finishingRef.current = false;
      }
    },
    [accessToken, entryMode, router]
  );

  /**
   * Record an answer the recruiter gave while extraction is still running.
   *
   * The write goes to the server before the answer is shown as saved, so the
   * history never claims something that is not durable. If extraction lands
   * first the server closes the window and says so rather than dropping the
   * answer silently.
   */
  const answerEarlyQuestion = React.useCallback(
    async (fieldPath: string, value: string) => {
      if (!accessToken || !draft) return;
      setAnsweringEarlyQuestion(true);
      try {
        const updated = await setJobImportPrefill(accessToken, draft.id, fieldPath, value);
        setDraft(updated);
        setAnnouncement("Answer saved.");
      } catch (caught) {
        setError(
          describeActionError(caught, "That answer could not be saved. Try again.")
        );
      } finally {
        answeringRef.current = false;
        setAnsweringEarlyQuestion(false);
      }
    },
    [accessToken, draft]
  );

  const activeDraftId = draft?.id ?? null;
  React.useEffect(() => {
    if (!accessToken || !activeDraftId) return;
    let cancelled = false;
    const draftId = activeDraftId;

    const read = async () => {
      // Never refresh over an answer in flight; the response for that answer is
      // newer than anything this poll can return.
      if (answeringRef.current) return;
      const [conversationResult, draftResult] = await Promise.allSettled([
        getJobImportConversation(accessToken, draftId),
        getJobImportDraft(accessToken, draftId),
      ]);
      if (cancelled || answeringRef.current) return;
      // Reconcile these independently. A temporary failure reading one view of
      // the same committed answer must not make the other one stale too.
      if (draftResult.status === "fulfilled") {
        setDraft(draftResult.value);
        if (readbackPendingRef.current) {
          readbackPendingRef.current = false;
          setAnnouncement("Draft refreshed.");
        }
      }
      if (conversationResult.status === "fulfilled") {
        setConversation(conversationResult.value);
      }
    };
    void read();

    // A slow heartbeat, and deliberately a *read*. Polling can never start a
    // provider stage, which is what makes an open question free to leave open.
    const timer = window.setInterval(read, 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [accessToken, activeDraftId]);

  // Leaving while a question is open records the pause. Returning explicitly
  // resumes the same deterministic turn; the read heartbeat remains passive and
  // never starts provider work.
  React.useEffect(() => {
    if (!accessToken || !draft || !conversation?.waiting) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        const request = pauseJobImportConversation(accessToken, draft.id);
        pauseConversationRef.current = request;
        void request.catch(() => undefined);
        return;
      }
      const pendingPause = pauseConversationRef.current;
      void (async () => {
        try {
          await pendingPause;
        } catch {
          // A best-effort pause failing must not prevent restoring the turn.
        }
        if (document.visibilityState !== "visible") return;
        try {
          setConversation(await beginJobImportConversation(accessToken, draft.id));
        } catch {
          // The passive heartbeat keeps the durable question recoverable.
        }
      })();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [accessToken, draft, conversation?.waiting]);

  /** Hand off to the ordinary editor. Always an explicit recruiter action. */
  const openNativeDraft = React.useCallback(async () => {
    if (!draft) {
      // The completion card is rendered from the conversation, so it can be on
      // screen while the draft snapshot is briefly absent — a refresh that
      // failed, a token that rotated. Returning here made "Open job draft" a
      // button that did nothing, which is indistinguishable from a broken app.
      // The id is in the address bar; use it.
      const fallbackId = new URL(window.location.href).searchParams.get("draft");
      if (fallbackId) {
        router.replace(`/post-job?importDraftId=${encodeURIComponent(fallbackId)}`);
      }
      return;
    }
    if (!accessToken) {
      // No usable token here — a persona switch or an expired session. Returning
      // silently would leave "Open job draft" doing nothing at all, which is the
      // worst possible ending after a completed conversation. The editor loads
      // the import draft with its own session, so hand off and let it.
      router.replace(`/post-job?importDraftId=${encodeURIComponent(draft.id)}`);
      return;
    }
    setAnsweringEarlyQuestion(true);
    try {
      if (draft.target_job_id) {
        router.replace(
          `/post-job?draftId=${encodeURIComponent(draft.target_job_id)}&imported=1`
        );
        return;
      }
      if (!draft.can_apply_to_native_draft) {
        router.replace(`/post-job?importDraftId=${encodeURIComponent(draft.id)}`);
        return;
      }
      const result = await applyJobImportDraft(accessToken, draft.id);
      router.replace(
        `/post-job?draftId=${encodeURIComponent(String(result.job.id))}&imported=1`
      );
    } catch {
      // Conversion is a convenience, not the only way through. Every answer is
      // already stored on the import draft, and the editor can hydrate straight
      // from it — so a failed conversion hands off rather than stranding the
      // recruiter on a completion screen with an error and nowhere to go.
      router.replace(`/post-job?importDraftId=${encodeURIComponent(draft.id)}`);
    } finally {
      setAnsweringEarlyQuestion(false);
    }
  }, [accessToken, draft, router]);

  /** Answer, skip, or leave — each persists before the UI moves on. */
  const conversationAction = React.useCallback(
    async (run: (token: string, draftId: string) => Promise<JobImportConversation>) => {
      if (!accessToken || !draft) return;
      answeringRef.current = true;
      setAnsweringEarlyQuestion(true);
      setError("");
      try {
        const nextConversation = await run(accessToken, draft.id);
        // The answers live on the draft, and the transcript and preview both
        // read from it. Reconcile both snapshots together: advancing the
        // conversation first briefly showed the next question before the reply
        // that caused it, which made a successful exchange look out of order.
        try {
          const nextDraft = await getJobImportDraft(accessToken, draft.id);
          setDraft(nextDraft);
          setConversation(nextConversation);
        } catch {
          // The write already committed. Advance truthfully and let the paired
          // read heartbeat restore the transcript/preview; saying "not saved"
          // here would invite a duplicate answer to a question already settled.
          setConversation(nextConversation);
          readbackPendingRef.current = true;
          setAnnouncement("Answer saved. Refreshing your draft…");
        }
      } catch (caught) {
        setError(describeActionError(caught, "That could not be saved. Try again."));
      } finally {
        answeringRef.current = false;
        setAnsweringEarlyQuestion(false);
      }
    },
    [accessToken, draft]
  );

  /**
   * The real candidate preview, rebuilt whenever the draft changes.
   *
   * It appears as soon as there is anything genuine to show and stays empty
   * before then — a preview of nothing is just a skeleton with extra steps.
   */
  const livePreview = React.useMemo(() => {
    if (!draft) return { node: null, provisionalCount: 0 };
    const snapshot = importPreviewSnapshot(draft);
    const filled = snapshot.recruiterFields.length + snapshot.provisionalFields.length;
    const roleName = importPreviewRoleName(snapshot, roleCatalog);
    if (filled === 0) return { node: null, provisionalCount: 0, roleName };
    const props = importPreviewProps(snapshot, {
      employerName: session?.user?.name ?? "Your channel",
      roleName,
    });
    return {
      node: <RecruiterJobPreview {...props} previewMode="rail" />,
      provisionalCount: snapshot.provisionalFields.length,
      roleName,
    };
  }, [draft, roleCatalog, session?.user?.name]);

  const processDraft = React.useCallback(
    async (current: JobImportDraft, signal?: AbortSignal) => {
      if (!accessToken || processingRef.current) return;
      processingRef.current = true;
      setDraft(current);
      setPhase("processing");
      setError("");
      setAnnouncement("Matching job details to CreatorJobs.");
      try {
        const result = await processJobImportDraft(accessToken, current.id, signal);
        setDraft(result.draft);
        if (result.outcome !== "already_processing") {
          await openCanonicalDraft(result.draft);
        }
      } catch (caught) {
        if (signal?.aborted) return;
        let failed = current;
        try {
          failed = await getJobImportDraft(accessToken, current.id);
          setDraft(failed);
        } catch {
          // Keep the actionable processing error as the primary message.
        }
        setPhase("failure");
        setError(readableImportError(caught, entryMode));
        trackJobImportEvent("job_import.failed", {
          sourceType: entryMode,
          durationMs: Math.max(0, Date.now() - startedAtRef.current),
          ...importCounts(failed),
        });
      } finally {
        processingRef.current = false;
      }
    },
    [accessToken, entryMode, openCanonicalDraft]
  );

  // Settle on the status itself, whichever reader happened to deliver it.
  //
  // This used to live inside the poll below, guarded on the draft still being
  // `processing` — so the branch that opens a finished draft only existed while
  // the draft was unfinished. The four-second heartbeat usually won that race,
  // and every time it did, a completed import kept its spinner forever. Reading
  // the status here removes the race instead of reordering it.
  React.useEffect(() => {
    if (!draft) return;
    const settlement = settlementFor(phase, draft.processing_status);
    if (settlement === "open_draft") {
      void openCanonicalDraft(draft);
    } else if (settlement === "show_failure") {
      // A failed attempt is shown as a failure. Retrying silently here would
      // hide a genuine outage behind a spinner, and retrying into a
      // manufactured empty draft is precisely the behaviour that turned a
      // provider timeout into the recruiter's data-entry job.
      setPhase("failure");
      setError(FAILURE_MESSAGE);
    } else if (settlement === "start_over") {
      // The draft being waited on was discarded or superseded elsewhere. It
      // will never report again, so waiting on it is waiting on nothing.
      setPhase("failure");
      setError(SUPERSEDED_MESSAGE);
    }
  }, [draft, openCanonicalDraft, phase]);

  // Keep reading while the backend still reports work in progress. This is only
  // a reader now — it never decides where the screen goes.
  React.useEffect(() => {
    if (
      phase !== "processing" ||
      !draft ||
      backendHasSettled(draft.processing_status) ||
      !accessToken
    ) {
      return;
    }
    const draftId = draft.id;
    const timer = window.setTimeout(() => {
      void getJobImportDraft(accessToken, draftId)
        .then(setDraft)
        // A rejected read must not end the loop. This effect re-arms on a new
        // draft identity, so without the tick a single failed poll would leave
        // nothing scheduled and the screen would wait on a reader that had
        // already stopped — the same permanent spinner by a slower route.
        .catch(() => setPollTick((tick) => tick + 1));
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [accessToken, draft, phase, pollTick]);

  React.useEffect(() => {
    if (
      restoredRef.current ||
      sessionStatus !== "authenticated" ||
      !accessToken
    ) {
      return;
    }
    restoredRef.current = true;
    const draftId = new URL(window.location.href).searchParams.get("draft");
    if (!draftId) return;
    setPhase("processing");
    void getJobImportDraft(accessToken, draftId)
      .then(async (loaded) => {
        setDraft(loaded);
        try {
          const loadedSource = await getJobImportSource(accessToken, loaded.source_id);
          setSource(loadedSource);
          if (loadedSource.source_type === "public_url") {
            setEntryMode("url");
            setUrl(loadedSource.source_url ?? loadedSource.final_source_url ?? "");
          } else {
            setEntryMode("text");
            setText(loadedSource.original_text ?? "");
          }
        } catch {
          // Draft recovery remains available if private source retention has ended.
        }
        if (terminalDraftStatuses.has(loaded.processing_status)) {
          await openCanonicalDraft(loaded);
        } else if (loaded.processing_status === "processing") {
          setAnnouncement("Matching job details to CreatorJobs.");
        } else if (loaded.processing_status === "processing_failed") {
          setPhase("failure");
          setError(FAILURE_MESSAGE);
        } else {
          await processDraft(loaded);
        }
      })
      .catch((caught) => {
        setDraftLocation(null);
        setPhase("entry");
        setError(describeActionError(caught, "This import draft could not be loaded."));
      });
  }, [accessToken, openCanonicalDraft, processDraft, sessionStatus]);

  const updateText = (value: string) => {
    const normalized = normalizeImportText(value);
    setText(normalized.text);
    setTruncated(normalized.truncated);
    requestIdRef.current = null;
  };

  const selectEntryMode = (mode: EntryMode, moveFocus = false) => {
    setEntryMode(mode);
    setError("");
    if (moveFocus) {
      window.requestAnimationFrame(() => {
        document.getElementById(`import-tab-${mode}`)?.focus();
      });
    }
  };

  const prepare = async () => {
    if (!accessToken || (entryMode === "text" ? !text.trim() : !url.trim())) return;
    let parsedUrl: URL | null = null;
    if (entryMode === "url") {
      try {
        parsedUrl = new URL(url.trim());
      } catch {
        setError("Enter a complete public job-listing URL.");
        return;
      }
      if (
        !["http:", "https:"].includes(parsedUrl.protocol) ||
        parsedUrl.username ||
        parsedUrl.password
      ) {
        setError("Enter a public HTTP or HTTPS URL without sign-in credentials.");
        return;
      }
    }
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const requestId = requestIdRef.current ?? crypto.randomUUID();
    requestIdRef.current = requestId;
    startedAtRef.current = Date.now();
    setLastDevelopmentScenario(null);
    setPhase("creating");
    setError("");
    setAnnouncement("Reading the job post.");
    trackJobImportEvent("job_import.started", { sourceType: entryMode });
    try {
      const createdSource =
        entryMode === "url" && parsedUrl
          ? await createJobImportUrlSource(
              accessToken,
              {
                source_url: parsedUrl.toString(),
                idempotency_key: `url-source-${requestId}`,
              },
              controller.signal
            )
          : await createJobImportSource(
              accessToken,
              {
                source_type: "pasted_text",
                source_title: "Pasted hiring details",
                original_text: text,
                idempotency_key: `text-source-${requestId}`,
              },
              controller.signal
            );
      if (controller.signal.aborted) return;
      setSource(createdSource);
      const initialized = await initializeJobImportDraft(
        accessToken,
        createdSource.id,
        { idempotency_key: `${entryMode}-draft-${requestId}` },
        controller.signal
      );
      if (controller.signal.aborted) return;
      setDraft(initialized);
      setDraftLocation(initialized.id);
      await processDraft(initialized, controller.signal);
    } catch (caught) {
      if (controller.signal.aborted) return;
      // Text the recruiter can fix belongs beside the box they would fix it in.
      // Three jobs pasted together is not "I couldn't finish this draft" with a
      // Retry that would fail identically — it is one edit away, and the edit
      // needs the textarea, which the failure screen replaces.
      const code =
        caught instanceof BackendRequestError ? caught.code ?? "" : "";
      const correctableHere =
        code === "JOB_IMPORT_TEXT_MULTIPLE_JOBS" ||
        code === "JOB_IMPORT_TEXT_NO_JOB_CONTENT";
      setPhase(correctableHere ? "entry" : "failure");
      setError(readableImportError(caught, entryMode));
      trackJobImportEvent("job_import.failed", {
        sourceType: entryMode,
        durationMs: Math.max(0, Date.now() - startedAtRef.current),
      });
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }
    }
  };

  const openDevelopmentFixture = async (
    scenario: DevelopmentJobImportScenario = developmentScenario
  ) => {
    if (!accessToken) return;
    startedAtRef.current = Date.now();
    setLastDevelopmentScenario(scenario);
    setPhase("applying");
    setError("");
    try {
      const result = await createDevelopmentJobImportFixture(
        accessToken,
        scenario
      );
      setDraftLocation(result.draft.id);
      setDraft(result.draft);
      try {
        setSource(await getJobImportSource(accessToken, result.draft.source_id));
      } catch {
        // The canvas falls back to a generic source label; not worth failing for.
      }
      if (result.draft.processing_status === "processing") {
        // An in-flight scenario. It belongs on the assistant canvas, where the
        // staged behaviour it exists to demonstrate actually lives — sending it
        // to Post Job would skip past the thing being inspected.
        setPhase("processing");
        return;
      }
      await openCanonicalDraft(result.draft);
    } catch (caught) {
      setPhase("failure");
      setError(describeActionError(caught, "The local import example could not be opened."));
    }
  };

  const cancel = () => {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setPhase("entry");
    setError("");
    setAnnouncement("Draft preparation cancelled. Your source is still here.");
  };

  const retry = () => {
    if (lastDevelopmentScenario) {
      void openDevelopmentFixture(lastDevelopmentScenario);
      return;
    }
    if (draft && ["awaiting_processing", "processing_failed"].includes(draft.processing_status)) {
      startedAtRef.current = Date.now();
      void processDraft(draft);
      return;
    }
    if (draft && terminalDraftStatuses.has(draft.processing_status)) {
      void openCanonicalDraft(draft);
      return;
    }
    void prepare();
  };

  const continueManually = () => {
    if (draft?.can_apply_to_native_draft) {
      void openCanonicalDraft(draft);
      return;
    }
    router.push(draft ? `/post-job?importDraftId=${encodeURIComponent(draft.id)}` : "/post-job");
  };

  const startDifferentImport = () => {
    setDraft(null);
    setSource(null);
    setError("");
    setPhase("entry");
    requestIdRef.current = null;
    setLastDevelopmentScenario(null);
    setDraftLocation(null);
  };

  if (sessionStatus === "loading") {
    return (
      <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white">
        <div className="mx-auto max-w-3xl">
          <PageLoading blocks={3} />
        </div>
      </main>
    );
  }

  if (sessionStatus !== "authenticated" || !accessToken) {
    return (
      <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white sm:px-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <PageHeader
            eyebrow="POST A JOB"
            title="Import job details"
            description="Sign in to keep the source and prepared draft private to your account."
          />
          <StateCard
            icon="file"
            title="Sign in to import a job"
            description="Your source and draft details stay private until you choose to publish."
            action={
              <button
                type="button"
                className={importPrimaryButton}
                onClick={() => void signIn(undefined, { callbackUrl: "/post-job/import" })}
              >
                Sign in
              </button>
            }
          />
        </div>
      </main>
    );
  }

  return (
    <main className="surface-canvas min-h-[calc(100vh-56px)] px-4 py-6 text-ink sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <PageHeader
          eyebrow="POST A JOB"
          title="Turn an existing post into a draft"
          description="Paste the job text or add a public URL. Bea will prepare what it can and ask only for the decisions that still need you."
        />
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {phase === "entry" ? (
          <div className="mx-auto max-w-3xl space-y-4">
            <div className="flex items-start gap-2.5 px-1 text-xs leading-5 text-muted">
              <Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
              <p>
                Private by default. Nothing is published until you review the draft and post it yourself.
              </p>
            </div>
            <div
              role="tablist"
              aria-label="Import source"
              className="grid w-full max-w-sm grid-cols-2 rounded-2xl border border-line bg-panel p-1 elev-1"
            >
              {(
                [
                  ["text", "Paste text"],
                  ["url", "Public URL"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  id={`import-tab-${mode}`}
                  type="button"
                  role="tab"
                  aria-selected={entryMode === mode}
                  aria-controls={`import-panel-${mode}`}
                  tabIndex={entryMode === mode ? 0 : -1}
                  className={`ui-press h-11 cursor-pointer rounded-xl px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 motion-reduce:transition-none ${
                    entryMode === mode
                      ? "surface-primary text-black elev-1"
                      : "text-muted hover:bg-wash hover:text-ink"
                  }`}
                  onClick={() => selectEntryMode(mode)}
                  onKeyDown={(event) => {
                    if (![
                      "ArrowLeft",
                      "ArrowRight",
                      "Home",
                      "End",
                    ].includes(event.key)) {
                      return;
                    }
                    event.preventDefault();
                    const modes: EntryMode[] = ["text", "url"];
                    const currentIndex = modes.indexOf(mode);
                    const nextMode =
                      event.key === "Home"
                        ? modes[0]
                        : event.key === "End"
                          ? modes[modes.length - 1]
                          : modes[
                              (currentIndex +
                                (event.key === "ArrowLeft" ? -1 : 1) +
                                modes.length) %
                                modes.length
                            ];
                    selectEntryMode(nextMode, true);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {entryMode === "text" ? (
              <div id="import-panel-text" role="tabpanel" aria-labelledby="import-tab-text">
                <PastePanel
                  text={text}
                  truncatedAtLimit={truncated}
                  restoredFromSession={Boolean(source && text)}
                  onTextChange={updateText}
                  onPrepare={() => void prepare()}
                  onClearRequest={() => updateText("")}
                />
              </div>
            ) : (
              <section
                id="import-panel-url"
                role="tabpanel"
                aria-labelledby="import-tab-url"
                className={importPanelClass}
                data-testid="url-import-panel"
              >
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-raised text-secondary elev-1">
                    <Icon name="globe" className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold tracking-tight text-ink">Import a public job page</h2>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      Use a page anyone can open without signing in. If a site blocks access, you can paste the text instead.
                    </p>
                  </div>
                </div>
                <label
                  htmlFor="job-import-url"
                  className="mt-6 block text-xs font-semibold text-secondary"
                >
                  Public listing URL
                </label>
                <input
                  id="job-import-url"
                  type="url"
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value);
                    requestIdRef.current = null;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && url.trim()) {
                      event.preventDefault();
                      void prepare();
                    }
                  }}
                  placeholder="https://example.com/jobs/video-editor"
                  className={`${importInputBase} mt-2`}
                  autoComplete="url"
                  data-testid="import-url-input"
                />
                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    className={importPrimaryButton}
                    disabled={!url.trim()}
                    onClick={() => void prepare()}
                    data-testid="import-url-prepare"
                  >
                    Prepare draft
                  </button>
                </div>
              </section>
            )}
            {error ? (
              <div role="alert" className="flex items-start gap-2.5 rounded-2xl border border-amber-200/20 bg-amber-200/[0.07] px-4 py-3 text-sm leading-6 text-amber-50">
                <Icon name="alert" className="mt-1 h-4 w-4 shrink-0 text-amber-200/90" />
                <p>{error}</p>
              </div>
            ) : null}
            {draft?.processing_status === "processing" ? (
              <button type="button" className={importGhostButton} onClick={() => setPhase("processing")}>
                Resume draft preparation
              </button>
            ) : null}
            {isDevelopmentRuntime ? (
              <section className="rounded-2xl border border-dashed border-white/15 p-4">
                <p className="text-xs font-semibold text-white/70">Local development</p>
                <p className="mt-1 text-xs text-white/45">
                  Inspect a private guided scenario without calling a provider.
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <label className="sr-only" htmlFor="development-import-scenario">
                    Guided import scenario
                  </label>
                  <select
                    id="development-import-scenario"
                    value={developmentScenario}
                    onChange={(event) =>
                      setDevelopmentScenario(
                        event.target.value as DevelopmentJobImportScenario
                      )
                    }
                    className={`${importInputBase} sm:max-w-xs`}
                    data-testid="import-development-scenario"
                  >
                    <option value="strong-decisions" className="bg-[#0b0b0f]">
                      Strong draft · a few decisions
                    </option>
                    <option value="thumbnail-designer" className="bg-[#0b0b0f]">
                      Thumbnail designer · role-specific help
                    </option>
                    <option value="scriptwriter" className="bg-[#0b0b0f]">
                      Scriptwriter · research and length
                    </option>
                    <option value="clean-import" className="bg-[#0b0b0f]">
                      Clean import · ready to edit
                    </option>
                    <option value="shine-school-editor" className="bg-[#0b0b0f]">
                      URL import · Chennai school editor
                    </option>
                    <option value="multi-craft" className="bg-[#0b0b0f]">
                      URL import · title names several crafts
                    </option>
                    <option value="labelled-pay-conflict" className="bg-[#0b0b0f]">
                      URL import · markup contradicts the copy
                    </option>
                    <option value="ceiling-only-pay" className="bg-[#0b0b0f]">
                      URL import · pay stated as a ceiling only
                    </option>
                    <option value="brand-discovery" className="bg-[#0b0b0f]">
                      URL import · brand discovery without About copy
                    </option>
                    <option value="checkpoint-currency" className="bg-[#0b0b0f]">
                      Checkpoint · pay needs a currency
                    </option>
                    <option value="checkpoint-trial" className="bg-[#0b0b0f]">
                      Checkpoint · is there a trial?
                    </option>
                    <option value="checkpoint-experience" className="bg-[#0b0b0f]">
                      Checkpoint · exact experience override
                    </option>
                    <option value="delayed-processing" className="bg-[#0b0b0f]">
                      Still preparing · early question
                    </option>
                    <option value="refresh-resume" className="bg-[#0b0b0f]">
                      Still preparing · one answer saved
                    </option>
                    <option value="answer-precedence" className="bg-[#0b0b0f]">
                      Your answer vs a later result
                    </option>
                    <option value="processing-failure" className="bg-[#0b0b0f]">
                      Processing failure · retry path
                    </option>
                  </select>
                  <button
                    type="button"
                    className={importGhostButton}
                    onClick={() => void openDevelopmentFixture()}
                    data-testid="open-import-review-fixture"
                  >
                    Open local scenario
                  </button>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {phase === "creating" || phase === "processing" || phase === "applying" ? (
          <DraftAssistantCanvas
            progress={{
              sourceType: entryMode === "url" ? "public_url" : "pasted_text",
              draft,
              sourceCreated: source !== null,
              nativeDraftReady: phase === "applying" && Boolean(draft?.target_job_id),
              waitingForRecruiter:
                (conversation?.waiting ?? false) && !answeringEarlyQuestion,
            }}
            sourceType={entryMode === "url" ? "public_url" : "pasted_text"}
            sourceLabel={
              source?.source_title ||
              (entryMode === "url"
                ? (() => {
                    try {
                      return new URL(url).hostname;
                    } catch {
                      return "Public job post";
                    }
                  })()
                : "Pasted job information")
            }
            sourceCharacterCount={entryMode === "url" ? null : text.length}
            earlyQuestionFields={draft?.early_question_fields ?? []}
            earlyAnswers={draft?.recruiter_prefill ?? {}}
            onAnswerEarlyQuestion={answerEarlyQuestion}
            onCancel={phase === "applying" ? null : cancel}
            busy={answeringEarlyQuestion}
            error={error || null}
            delayed={delayed}
            retrying={retrying}
            preview={livePreview.node}
            provisionalCount={livePreview.provisionalCount}
            waitingForRecruiter={
              (conversation?.waiting ?? false) && !answeringEarlyQuestion
            }
            conversation={conversation}
            jobTitle={
              typeof draft?.fields.find((f) => f.field_path === "title")
                ?.effective_value === "string"
                ? (draft.fields.find((f) => f.field_path === "title")
                    ?.effective_value as string)
                : null
            }
            roleName={livePreview.roleName}
            filledCount={livePreview.provisionalCount + Object.keys(draft?.recruiter_prefill ?? {}).length}
            onAnswerQuestion={(fieldPath, value: JobImportNonNullJsonValue) =>
              void conversationAction((token, id) =>
                answerJobImportQuestion(
                  token,
                  id,
                  fieldPath,
                  value,
                  conversation?.recruiter_context_version
                )
              )
            }
            onSkipQuestion={() =>
              void conversationAction((token, id) => skipJobImportQuestion(token, id))
            }
            onSkipRemaining={() =>
              void conversationAction((token, id) =>
                skipJobImportQuestion(token, id, true)
              )
            }
            onContinueManually={() =>
              void conversationAction((token, id) =>
                continueJobImportManually(token, id)
              )
            }
            onOpenDraft={() => void openNativeDraft()}
          />
        ) : null}

        {phase === "failure" ? (
          <section className={`${importPanelClass} mx-auto max-w-3xl`} data-testid="job-import-failure">
            {/* Bea stays present through a failure. Swapping her for a warning
                icon made the failure read as a different product rather than the
                same assistant reporting that it could not finish. */}
            <DraftAssistantRobot state="failed" size={44} />
            <h2 className="mt-4 text-lg font-semibold">I couldn’t finish this draft</h2>
            <p role="alert" className="mt-2 max-w-2xl text-sm leading-6 text-white/58">
              {error}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" className={importPrimaryButton} onClick={retry}>
                Retry
              </button>
              <button type="button" className={importGhostButton} onClick={continueManually}>
                Continue manually
              </button>
              {entryMode === "url" ? (
                <button
                  type="button"
                  className={importGhostButton}
                  onClick={() => {
                    setPhase("entry");
                    selectEntryMode("text");
                  }}
                >
                  Paste text instead
                </button>
              ) : null}
              <button type="button" className={importGhostButton} onClick={startDifferentImport}>
                Start a different import
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
