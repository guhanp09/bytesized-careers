"use client";

// Import Hiring Post flow host. State lives in the pure reducer
// (lib/importJob/flowMachine); this component owns the side effects: owner-stamped
// sessionStorage (deferred until the NextAuth session resolves — plan D3),
// synchronous parsing with an anti-flash indicator (plan D15), and the handoff
// navigation to the wizard.

import React from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import ConfirmDialog from "../ui/ConfirmDialog";
import { PageHeader, StateCard } from "../ui";
import { parseJobPost } from "../../lib/importJob/parseJobPost";
import {
  importFlowReducer,
  initialImportFlowState,
  suggestedCategory,
} from "../../lib/importJob/flowMachine";
import { toWizardPrefill } from "../../lib/importJob/applyToWizard";
import {
  ANON_OWNER,
  clearImportSource,
  readImportSource,
  writeImportHandoff,
  writeImportSource,
} from "../../lib/importJob/handoff";
import PastePanel from "./PastePanel";
import ReviewSummary from "./ReviewSummary";
import { importGhostButton, importPanelClass } from "./importPrimitives";

const INDICATOR_DELAY_MS = 150;
const INDICATOR_MIN_VISIBLE_MS = 250;

export default function ImportJobPageClient() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const [state, dispatch] = React.useReducer(importFlowReducer, initialImportFlowState);
  const [confirmAction, setConfirmAction] = React.useState<"clear" | "startOver" | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  const [showIndicator, setShowIndicator] = React.useState(false);
  const restoreAttemptedRef = React.useRef(false);
  const handoffFiredRef = React.useRef(false);
  const persistTimerRef = React.useRef<number | null>(null);

  // Authentication readiness precedes every owner-stamped storage access (D3):
  // a loading session is never treated as "anon".
  const sessionResolved = sessionStatus !== "loading";
  const resolvedOwner = sessionStatus === "authenticated" ? (session?.backendUserId ?? ANON_OWNER) : ANON_OWNER;

  // Restore the paste once the session resolves.
  React.useEffect(() => {
    if (!sessionResolved || restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;
    const restored = readImportSource(resolvedOwner);
    if (restored) dispatch({ type: "RESTORE_SOURCE", text: restored });
  }, [sessionResolved, resolvedOwner]);

  // Debounced owner-stamped persistence of the paste.
  const persistText = React.useCallback(
    (text: string) => {
      if (!sessionResolved) return;
      if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = window.setTimeout(() => {
        if (text.trim()) writeImportSource(text, resolvedOwner);
        else clearImportSource();
      }, 500);
    },
    [sessionResolved, resolvedOwner]
  );
  React.useEffect(
    () => () => {
      if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
    },
    []
  );

  // ---- Analyze: synchronous parse with anti-flash indicator (D15) ----
  React.useEffect(() => {
    if (state.phase !== "analyzing") {
      setShowIndicator(false);
      return;
    }
    let cancelled = false;
    const indicatorTimer = window.setTimeout(() => {
      if (!cancelled) {
        setShowIndicator(true);
        setAnnouncement("Preparing draft…");
      }
    }, INDICATOR_DELAY_MS);

    const frame = window.requestAnimationFrame(() => {
      const startedAt = performance.now();
      let done: () => void;
      try {
        const result = parseJobPost(state.text);
        done = () => dispatch({ type: "ANALYZE_DONE", result });
      } catch {
        done = () => dispatch({ type: "ANALYZE_FAILED", message: "Something went wrong while analyzing." });
      }
      const elapsed = performance.now() - startedAt;
      if (elapsed >= INDICATOR_DELAY_MS) {
        // Indicator has (or will have) appeared; keep it visible briefly to avoid a flash.
        window.setTimeout(() => {
          if (!cancelled) done();
        }, INDICATOR_MIN_VISIBLE_MS);
      } else if (!cancelled) {
        done();
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(indicatorTimer);
      window.cancelAnimationFrame(frame);
    };
    // state.text is stable for the lifetime of the analyzing phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  // Announce the result summary for screen readers.
  React.useEffect(() => {
    if (state.phase === "review") {
      const d = state.result.draft;
      const entries = (
        Object.entries(d) as Array<[string, { status: string; value: unknown } | { contactLines: unknown }]>
      ).filter(([key]) => key !== "applicationSignals") as Array<[string, { status: string; value: unknown }]>;
      const imported = entries.filter(([, e]) => e.status === "imported" && e.value !== null).length;
      const review = entries.filter(([, e]) => e.status === "review" || e.status === "conflict").length;
      const missing = entries.filter(([, e]) => e.status === "missing").length;
      setAnnouncement(`Draft prepared — ${imported} details found, ${review} need a look, ${missing} missing.`);
    } else if (state.phase === "notJobLikely") {
      setAnnouncement("This doesn't look like a hiring post.");
    } else if (state.phase === "handingOff") {
      setAnnouncement("Opening the job editor…");
    }
  }, [state]);

  // ---- Handoff (D3/D12): write the owner-stamped payload, then navigate ----
  React.useEffect(() => {
    if (state.phase !== "handingOff" || handoffFiredRef.current || !sessionResolved) return;
    handoffFiredRef.current = true;
    const { prefill, meta, initialStep } = toWizardPrefill(
      state.result,
      state.chosenTitleIndex,
      state.chosenCategory
    );
    writeImportHandoff({
      version: 1,
      createdAt: Date.now(),
      owner: resolvedOwner,
      initialStep,
      prefill,
      meta,
    });
    clearImportSource();
    router.push("/post-job?import=1");
  }, [state, sessionResolved, resolvedOwner, router]);

  const handleTextChange = (text: string) => {
    dispatch({ type: "TEXT_CHANGED", text });
    persistText(text);
  };

  const handleConfirm = () => {
    if (confirmAction === null) return;
    setConfirmAction(null);
    dispatch({ type: "RESET" });
    clearImportSource();
  };

  const requestClear = () => {
    if (state.phase === "paste" && Array.from(state.text).length <= 200) {
      dispatch({ type: "RESET" });
      clearImportSource();
      return;
    }
    setConfirmAction(state.phase === "paste" ? "clear" : "startOver");
  };

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <PageHeader
          eyebrow="POST A JOB"
          title="Import a hiring post"
          description="Paste a job announcement you've already written. We'll prepare a CreatorJobs draft — nothing is published until you say so."
        />

        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {state.phase === "paste" ? (
          <div className="mx-auto max-w-3xl">
            <PastePanel
              text={state.text}
              truncatedAtLimit={state.truncatedAtLimit}
              restoredFromSession={state.restoredFromSession}
              onTextChange={handleTextChange}
              onPrepare={() => dispatch({ type: "ANALYZE" })}
              onClearRequest={requestClear}
            />
          </div>
        ) : null}

        {state.phase === "analyzing" ? (
          <div className="mx-auto max-w-3xl">
            <section className={`${importPanelClass} min-h-[200px]`} aria-hidden={!showIndicator}>
              {showIndicator ? (
                <div className="space-y-3" data-testid="import-preparing">
                  <p className="text-sm text-white/70">Preparing draft…</p>
                  <div className="ui-skeleton h-3 w-2/3 rounded-full" />
                </div>
              ) : null}
            </section>
          </div>
        ) : null}

        {state.phase === "notJobLikely" ? (
          <div className="mx-auto max-w-3xl" data-testid="import-not-job">
            <StateCard
              icon="alert"
              title="This doesn't look like a hiring post"
              description={`${state.result.classification.reasons.join(". ")}${
                state.result.classification.reasons.length ? ". " : ""
              }You can still try, or edit the text and analyze again.`}
              action={
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={importGhostButton}
                    onClick={() => dispatch({ type: "PARSE_ANYWAY" })}
                    data-testid="import-parse-anyway"
                  >
                    Parse anyway
                  </button>
                  <button
                    type="button"
                    className={importGhostButton}
                    onClick={() => dispatch({ type: "BACK_TO_EDIT" })}
                  >
                    Edit text
                  </button>
                </div>
              }
            />
          </div>
        ) : null}

        {state.phase === "parseError" ? (
          <div className="mx-auto max-w-3xl">
            <StateCard
              icon="alert"
              title="Something went wrong while analyzing"
              description="Your pasted text is untouched — go back and try again."
              action={
                <button type="button" className={importGhostButton} onClick={() => dispatch({ type: "BACK_TO_EDIT" })}>
                  Back to text
                </button>
              }
            />
          </div>
        ) : null}

        {state.phase === "review" || state.phase === "handingOff" ? (
          <ReviewSummary
            result={state.result}
            chosenTitleIndex={state.chosenTitleIndex}
            chosenCategory={state.chosenCategory}
            suggestedCategoryValue={suggestedCategory(state.result, state.chosenTitleIndex)}
            handingOff={state.phase === "handingOff"}
            onSelectTitle={(index) => dispatch({ type: "SELECT_TITLE_ALTERNATIVE", index })}
            onSelectCategory={(category) => dispatch({ type: "SELECT_CATEGORY", category })}
            onContinue={() => dispatch({ type: "CONTINUE_TO_EDITOR" })}
            onBackToEdit={() => dispatch({ type: "BACK_TO_EDIT" })}
            onStartOver={() => setConfirmAction("startOver")}
          />
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction === "clear" ? "Clear pasted text?" : "Start over?"}
        body={
          confirmAction === "clear"
            ? "Your pasted post will be removed from this page."
            : "This clears the pasted text and the prepared draft."
        }
        confirmLabel={confirmAction === "clear" ? "Clear" : "Start over"}
        destructive
        onConfirm={handleConfirm}
        onCancel={() => setConfirmAction(null)}
      />
    </main>
  );
}
