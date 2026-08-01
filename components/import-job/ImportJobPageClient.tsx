"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { BackendRequestError, describeActionError } from "../../lib/backendClient";
import { trackJobImportEvent } from "../../lib/jobImportAnalytics";
import {
  applyJobImportDraft,
  createDevelopmentJobImportFixture,
  createJobImportSource,
  createJobImportUrlSource,
  getJobImportDraft,
  getJobImportSource,
  initializeJobImportDraft,
  processJobImportDraft,
  type JobImportDraft,
  type JobImportSource,
} from "../../lib/jobImportReadiness";
import { normalizeImportText } from "../../lib/importJob/normalize";
import { Icon } from "../Icons";
import { PageHeader, PageLoading, StateCard } from "../ui";
import PastePanel from "./PastePanel";
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

const terminalDraftStatuses = new Set([
  "awaiting_recruiter_review",
  "partially_reviewed",
  "ready_to_apply",
  "applied_to_native_draft",
]);

function setDraftLocation(draftId: string | null) {
  const next = new URL(window.location.href);
  if (draftId) next.searchParams.set("draft", draftId);
  else next.searchParams.delete("draft");
  window.history.replaceState({}, "", `${next.pathname}${next.search}${next.hash}`);
}

function readableImportError(error: unknown, sourceType: EntryMode): string {
  const code = error instanceof BackendRequestError ? error.code ?? "" : "";
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
  return describeActionError(
    error,
    sourceType === "url"
      ? "We couldn’t prepare a draft from that page. Try again or paste the job text."
      : "We couldn’t prepare a draft from that text. Try again or continue manually."
  );
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

function PreparingSurface({
  phase,
  delayed,
  sourceType,
  onCancel,
}: {
  phase: Exclude<Phase, "entry" | "failure">;
  delayed: boolean;
  sourceType: EntryMode;
  onCancel: () => void;
}) {
  const activeIndex = phase === "creating" ? 0 : phase === "processing" ? 1 : 2;
  const stages = ["Reading the job post", "Understanding the role", "Preparing your draft"];
  return (
    <section
      className={`${importPanelClass} mx-auto max-w-3xl overflow-hidden`}
      aria-labelledby="job-import-progress-title"
      data-testid="job-import-preparing"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
            Creating your draft
          </p>
          <h2 id="job-import-progress-title" className="mt-2 text-xl font-semibold text-white">
            {stages[activeIndex]}
          </h2>
          <p className="mt-2 text-sm leading-6 text-white/55">
            {delayed
              ? "This is taking a little longer than usual. Your source is safe, and you can keep waiting or cancel."
              : sourceType === "url"
                ? "We’re reading the public page and preparing the same Post Job form you already use."
                : "We’re turning your notes into the same Post Job form you already use."}
          </p>
        </div>
        {phase !== "applying" ? (
          <button
            type="button"
            className={importGhostButton}
            onClick={onCancel}
            data-testid="job-import-cancel"
          >
            Cancel
          </button>
        ) : null}
      </div>

      <ol className="mt-6 grid gap-2 sm:grid-cols-3" aria-label="Draft preparation progress">
        {stages.map((label, index) => {
          const complete = index < activeIndex;
          const active = index === activeIndex;
          return (
            <li
              key={label}
              aria-current={active ? "step" : undefined}
              className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors motion-reduce:transition-none ${
                active
                  ? "border-white/20 bg-white/[0.08] text-white"
                  : complete
                    ? "border-emerald-300/15 bg-emerald-300/[0.05] text-emerald-100/75"
                    : "border-white/[0.07] text-white/38"
              }`}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current/25">
                {complete ? <Icon name="check" className="h-3 w-3" /> : index + 1}
              </span>
              {label}
            </li>
          );
        })}
      </ol>

      <div className="mt-6 rounded-2xl border border-white/[0.07] bg-black/20 p-4" aria-hidden="true">
        <div className="ui-skeleton h-3 w-28 rounded-full motion-reduce:animate-none" />
        <div className="ui-skeleton mt-4 h-10 w-full rounded-xl motion-reduce:animate-none" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="ui-skeleton h-10 rounded-xl motion-reduce:animate-none" />
          <div className="ui-skeleton h-10 rounded-xl motion-reduce:animate-none" />
        </div>
      </div>
    </section>
  );
}

export default function ImportJobPageClient() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const [phase, setPhase] = React.useState<Phase>("entry");
  const [entryMode, setEntryMode] = React.useState<EntryMode>("text");
  const [text, setText] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [truncated, setTruncated] = React.useState(false);
  const [draft, setDraft] = React.useState<JobImportDraft | null>(null);
  const [source, setSource] = React.useState<JobImportSource | null>(null);
  const [error, setError] = React.useState("");
  const [delayed, setDelayed] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState("");
  const accessToken = session?.backendAccessToken ?? "";
  const restoredRef = React.useRef(false);
  const processingRef = React.useRef(false);
  const finishingRef = React.useRef(false);
  const requestControllerRef = React.useRef<AbortController | null>(null);
  const requestIdRef = React.useRef<string | null>(null);
  const startedAtRef = React.useRef(0);

  React.useEffect(() => {
    if (!["creating", "processing"].includes(phase)) {
      setDelayed(false);
      return;
    }
    const timer = window.setTimeout(() => setDelayed(true), 8_000);
    return () => window.clearTimeout(timer);
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
      if (!readyDraft.can_apply_to_native_draft) {
        setDraft(readyDraft);
        setPhase("failure");
        setError(
          "We prepared part of the draft, but a job title still needs your input. Continue in Post Job to finish it."
        );
        setAnnouncement("Part of the draft is ready. Continue manually to finish it.");
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
      } catch (caught) {
        setPhase("failure");
        setError(readableImportError(caught, entryMode));
        trackJobImportEvent("job_import.failed", {
          sourceType: entryMode,
          durationMs: Math.max(0, Date.now() - startedAtRef.current),
        });
      } finally {
        finishingRef.current = false;
      }
    },
    [accessToken, entryMode, router]
  );

  const processDraft = React.useCallback(
    async (current: JobImportDraft, signal?: AbortSignal) => {
      if (!accessToken || processingRef.current) return;
      processingRef.current = true;
      setDraft(current);
      setPhase("processing");
      setError("");
      setAnnouncement("Understanding the role.");
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

  React.useEffect(() => {
    if (
      phase !== "processing" ||
      draft?.processing_status !== "processing" ||
      !accessToken
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void getJobImportDraft(accessToken, draft.id)
        .then((next) => {
          setDraft(next);
          if (terminalDraftStatuses.has(next.processing_status)) {
            void openCanonicalDraft(next);
          } else if (next.processing_status === "processing_failed") {
            setPhase("failure");
            setError("We couldn’t finish this draft. Retry, or continue manually.");
          }
        })
        .catch(() => undefined);
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [accessToken, draft, openCanonicalDraft, phase]);

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
          setAnnouncement("Understanding the role.");
        } else if (loaded.processing_status === "processing_failed") {
          setPhase("failure");
          setError("We couldn’t finish this draft. Retry, or continue manually.");
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
      setPhase("failure");
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

  const openDevelopmentFixture = async () => {
    if (!accessToken) return;
    startedAtRef.current = Date.now();
    setPhase("applying");
    setError("");
    try {
      const result = await createDevelopmentJobImportFixture(accessToken);
      setDraftLocation(result.draft.id);
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
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <PageHeader
          eyebrow="POST A JOB"
          title="Import job details"
          description="Paste an existing post or public URL. We’ll prepare a draft, then open it in the normal Post Job flow."
        />
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {phase === "entry" ? (
          <div className="mx-auto max-w-3xl space-y-4">
            <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-xs leading-relaxed text-white/60">
              <p className="font-semibold text-white/75">Private import</p>
              <p className="mt-1">
                CreatorJobs uses the source only to prepare your private draft. Nothing is
                published, and uncertain details stay flagged in Post Job.
              </p>
            </section>
            <div
              role="tablist"
              aria-label="Import source"
              className="inline-flex rounded-2xl border border-white/10 bg-white/[0.035] p-1"
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
                  className={`h-11 rounded-xl px-4 text-sm font-semibold transition motion-reduce:transition-none ${
                    entryMode === mode
                      ? "bg-white text-black"
                      : "text-white/60 hover:text-white"
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
                <h2 className="text-sm font-semibold text-white/85">
                  Import a public job-listing page
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-white/55">
                  Enter a page anyone can open without signing in. Some sites block automated
                  reading; you can always paste the text instead.
                </p>
                <label
                  htmlFor="job-import-url"
                  className="mt-5 block text-xs font-semibold text-white/70"
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
                <div className="mt-4 flex justify-end">
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
              <p role="alert" className="text-sm text-amber-200/90">
                {error}
              </p>
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
                  Open a prepared private fixture without calling a provider.
                </p>
                <button
                  type="button"
                  className={`${importGhostButton} mt-3`}
                  onClick={() => void openDevelopmentFixture()}
                  data-testid="open-import-review-fixture"
                >
                  Open prepared example
                </button>
              </section>
            ) : null}
          </div>
        ) : null}

        {phase === "creating" || phase === "processing" || phase === "applying" ? (
          <PreparingSurface
            phase={phase}
            delayed={delayed}
            sourceType={entryMode}
            onCancel={cancel}
          />
        ) : null}

        {phase === "failure" ? (
          <section className={`${importPanelClass} mx-auto max-w-3xl`} data-testid="job-import-failure">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-200/10 text-amber-100/80">
              <Icon name="file" className="h-4 w-4" />
            </span>
            <h2 className="mt-4 text-lg font-semibold">Your draft needs a little help</h2>
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
