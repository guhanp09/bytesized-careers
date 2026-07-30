"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { PageHeader, PageLoading, StateCard } from "../ui";
import ConfirmDialog from "../ui/ConfirmDialog";
import {
  applyJobImportDraft,
  createDevelopmentJobImportFixture,
  createJobImportSource,
  createJobImportUrlSource,
  discardJobImportDraft,
  getJobImportDraft,
  getJobImportSource,
  initializeJobImportDraft,
  processJobImportDraft,
  resolveJobImportConflict,
  reviewJobImportField,
  type JobImportDraft,
  type JobImportField,
  type JobImportNonNullJsonValue,
  type JobImportSource,
} from "../../lib/jobImportReadiness";
import { describeActionError } from "../../lib/backendClient";
import { normalizeImportText } from "../../lib/importJob/normalize";
import PastePanel from "./PastePanel";
import ImportReviewWorkspace from "./ImportReviewWorkspace";
import {
  importGhostButton,
  importPanelClass,
  importInputBase,
  importPrimaryButton,
} from "./importPrimitives";

type Phase = "entry" | "creating" | "processing" | "review" | "source_summary";
type EntryMode = "text" | "url";

const isDevelopmentRuntime =
  process.env.NODE_ENV === "development" ||
  ["development", "test"].includes(process.env.NEXT_PUBLIC_APP_ENV ?? "");

function setDraftLocation(draftId: string | null) {
  const url = new URL(window.location.href);
  if (draftId) url.searchParams.set("draft", draftId);
  else url.searchParams.delete("draft");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function readableProcessingError(error: unknown): string {
  const message = describeActionError(
    error,
    "We couldn’t prepare this import. Your source is still private and you can retry."
  );
  if (/api key|configuration|configured/i.test(message)) {
    return "Text processing is unavailable right now. Your source is still private; try again later or use the local review example in development.";
  }
  return message;
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
  const [busyField, setBusyField] = React.useState<string | null>(null);
  const [applying, setApplying] = React.useState(false);
  const [confirmStartOver, setConfirmStartOver] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState("");
  const restoredRef = React.useRef(false);
  const urlRequestIdRef = React.useRef<string | null>(null);

  const accessToken = session?.backendAccessToken ?? "";

  React.useEffect(() => {
    if (
      restoredRef.current ||
      sessionStatus !== "authenticated" ||
      !accessToken
    )
      return;
    restoredRef.current = true;
    const draftId = new URL(window.location.href).searchParams.get("draft");
    if (!draftId) return;
    setPhase("processing");
    void getJobImportDraft(accessToken, draftId)
      .then((loaded) => {
        setDraft(loaded);
        void getJobImportSource(accessToken, loaded.source_id)
          .then((loadedSource) => {
            setSource(loadedSource);
            setEntryMode(loadedSource.source_type === "public_url" ? "url" : "text");
          })
          .catch(() => undefined);
        if (
          loaded.processing_status === "awaiting_processing" ||
          loaded.processing_status === "processing" ||
          loaded.processing_status === "processing_failed"
        ) {
          setPhase("processing");
        } else {
          setPhase("review");
          setAnnouncement("Private import review loaded.");
        }
      })
      .catch((caught) => {
        setDraftLocation(null);
        setPhase("entry");
        setError(describeActionError(caught, "This import draft could not be loaded."));
      });
  }, [accessToken, sessionStatus]);

  React.useEffect(() => {
    if (
      phase !== "processing" ||
      draft?.processing_status !== "processing" ||
      !accessToken
    )
      return;
    const timer = window.setTimeout(() => {
      void getJobImportDraft(accessToken, draft.id)
        .then((next) => {
          setDraft(next);
          if (
            next.processing_status === "awaiting_recruiter_review" ||
            next.processing_status === "partially_reviewed" ||
            next.processing_status === "ready_to_apply"
          ) {
            setPhase("review");
            setAnnouncement("Draft prepared. Review every imported detail.");
          }
        })
        .catch((caught) => setError(describeActionError(caught)));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [accessToken, draft, phase]);

  const updateText = (value: string) => {
    const normalized = normalizeImportText(value);
    setText(normalized.text);
    setTruncated(normalized.truncated);
  };

  const processDraft = React.useCallback(
    async (current: JobImportDraft) => {
      setPhase("processing");
      setError("");
      setAnnouncement("Preparing a private structured draft.");
      try {
        const result = await processJobImportDraft(accessToken, current.id);
        setDraft(result.draft);
        if (result.outcome === "already_processing") {
          setAnnouncement("Processing is already in progress.");
          return;
        }
        setPhase("review");
        setAnnouncement("Draft prepared. Review every imported detail.");
      } catch (caught) {
        try {
          const failed = await getJobImportDraft(accessToken, current.id);
          setDraft(failed);
        } catch {
          // The actionable processing error remains the primary message.
        }
        setError(readableProcessingError(caught));
      }
    },
    [accessToken]
  );

  const prepareText = async () => {
    if (!text.trim() || !accessToken) return;
    setPhase("creating");
    setError("");
    setAnnouncement("Saving your source privately.");
    const requestId = crypto.randomUUID();
    try {
      const source = await createJobImportSource(accessToken, {
        source_type: "pasted_text",
        source_title: "Pasted hiring details",
        original_text: text,
        idempotency_key: `text-source-${requestId}`,
      });
      setSource(source);
      const initialized = await initializeJobImportDraft(accessToken, source.id, {
        idempotency_key: `text-draft-${requestId}`,
      });
      setDraft(initialized);
      setDraftLocation(initialized.id);
      await processDraft(initialized);
    } catch (caught) {
      setPhase("entry");
      setError(describeActionError(caught, "We couldn’t save this private import source."));
    }
  };

  const prepareUrl = async () => {
    if (!url.trim() || !accessToken) return;
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      setError("Enter a complete public job-listing URL.");
      return;
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      setError("Enter a public HTTP or HTTPS URL without sign-in credentials.");
      return;
    }
    setPhase("creating");
    setError("");
    setAnnouncement("Retrieving the public page safely.");
    const requestId = urlRequestIdRef.current ?? crypto.randomUUID();
    urlRequestIdRef.current = requestId;
    try {
      const createdSource = await createJobImportUrlSource(accessToken, {
        source_url: parsed.toString(),
        idempotency_key: `url-source-${requestId}`,
      });
      setSource(createdSource);
      const initialized = await initializeJobImportDraft(accessToken, createdSource.id, {
        idempotency_key: `url-draft-${requestId}`,
      });
      setDraft(initialized);
      setDraftLocation(initialized.id);
      await processDraft(initialized);
    } catch (caught) {
      setPhase("entry");
      setError(
        describeActionError(
          caught,
          "We couldn’t retrieve that public page. Check the URL and try again."
        )
      );
    }
  };

  const openDevelopmentFixture = async () => {
    if (!accessToken) return;
    setPhase("creating");
    setError("");
    try {
      const result = await createDevelopmentJobImportFixture(accessToken);
      setDraft(result.draft);
      void getJobImportSource(accessToken, result.draft.source_id)
        .then(setSource)
        .catch(() => undefined);
      setDraftLocation(result.draft.id);
      setPhase("review");
      setAnnouncement("Development review example opened.");
    } catch (caught) {
      setPhase("entry");
      setError(
        describeActionError(caught, "The development review example could not be opened.")
      );
    }
  };

  const reviewAction = async (
    field: JobImportField,
    action:
      | { kind: "accept" | "reject" | "reset" }
      | { kind: "edit"; value: JobImportNonNullJsonValue }
      | { kind: "resolve"; index: number }
      | { kind: "replace"; value: JobImportNonNullJsonValue }
  ) => {
    if (!draft || !accessToken) return;
    setBusyField(field.field_path);
    setError("");
    try {
      let next: JobImportDraft;
      if (action.kind === "resolve") {
        next = await resolveJobImportConflict(
          accessToken,
          draft.id,
          field.field_path,
          { selected_value_index: action.index as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 }
        );
      } else if (action.kind === "replace") {
        next = await resolveJobImportConflict(
          accessToken,
          draft.id,
          field.field_path,
          { replacement_value: action.value }
        );
      } else if (action.kind === "edit") {
        next = await reviewJobImportField(accessToken, draft.id, field.field_path, {
          action: "edit",
          edited_value: action.value,
        });
      } else {
        next = await reviewJobImportField(accessToken, draft.id, field.field_path, {
          action: action.kind,
        });
      }
      setDraft(next);
      setAnnouncement(`${field.field_path.replaceAll("_", " ")} updated.`);
    } catch (caught) {
      setError(describeActionError(caught, "That review decision could not be saved."));
      throw caught;
    } finally {
      setBusyField(null);
    }
  };

  const applyDraft = async () => {
    if (!draft || !accessToken) return;
    setApplying(true);
    setError("");
    try {
      const result = await applyJobImportDraft(accessToken, draft.id);
      setDraft(result.draft);
      setAnnouncement("Private native job draft created. Opening the full editor.");
      router.push(`/post-job?draftId=${encodeURIComponent(String(result.job.id))}`);
    } catch (caught) {
      setError(describeActionError(caught, "The native job draft could not be created."));
    } finally {
      setApplying(false);
    }
  };

  const startOver = async () => {
    setConfirmStartOver(false);
    if (
      draft &&
      accessToken &&
      !["applied_to_native_draft", "discarded", "superseded"].includes(
        draft.processing_status
      )
    ) {
      try {
        await discardJobImportDraft(accessToken, draft.id);
      } catch {
        // Starting a fresh local flow must not discard a server-side audit record.
      }
    }
    setDraft(null);
    setSource(null);
    setText("");
    setUrl("");
    urlRequestIdRef.current = null;
    setTruncated(false);
    setError("");
    setDraftLocation(null);
    setPhase("entry");
    setAnnouncement("Ready for a new private import.");
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
            description="Sign in to keep source text and imported suggestions private to your account."
          />
          <StateCard
            icon="file"
            title="Sign in to import a job"
            description="Your source, evidence, and review decisions are private recruiter data."
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
          description="Start from rough notes or an existing description, review every suggestion, then continue in the full job editor."
        />
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {phase === "entry" ? (
          <div className="mx-auto max-w-3xl space-y-4">
            <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-xs leading-relaxed text-white/60">
              <p className="font-semibold text-white/75">Private import</p>
              <p className="mt-1">
                CreatorJobs stores normalized source text privately for extraction and review.
                Suggestions are never published or treated as confirmed until you act.
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
                  type="button"
                  role="tab"
                  aria-selected={entryMode === mode}
                  className={`h-10 rounded-xl px-4 text-sm font-semibold transition ${
                    entryMode === mode
                      ? "bg-white text-black"
                      : "text-white/60 hover:text-white"
                  }`}
                  onClick={() => {
                    setEntryMode(mode);
                    setError("");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {entryMode === "text" ? (
              <PastePanel
                text={text}
                truncatedAtLimit={truncated}
                restoredFromSession={false}
                onTextChange={updateText}
                onPrepare={() => void prepareText()}
                onClearRequest={() => updateText("")}
              />
            ) : (
              <section className={importPanelClass} data-testid="url-import-panel">
                <h2 className="text-sm font-semibold text-white/85">
                  Import a public job-listing page
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-white/55">
                  Enter a page anyone can open without signing in. CreatorJobs retrieves only
                  that page—without cookies, browser sessions, JavaScript, forms, or linked
                  resources. Some websites may not be supported.
                </p>
                <label htmlFor="job-import-url" className="mt-5 block text-xs font-semibold text-white/70">
                  Public listing URL
                </label>
                <input
                  id="job-import-url"
                  type="url"
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value);
                    urlRequestIdRef.current = null;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && url.trim()) {
                      event.preventDefault();
                      void prepareUrl();
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
                    onClick={() => void prepareUrl()}
                    data-testid="import-url-prepare"
                  >
                    Retrieve and prepare
                  </button>
                </div>
              </section>
            )}
            {error ? (
              <p role="alert" className="text-sm text-amber-200/90">
                {error}
              </p>
            ) : null}
            {isDevelopmentRuntime ? (
              <section className="rounded-2xl border border-dashed border-white/15 p-4">
                <p className="text-xs font-semibold text-white/70">Local development</p>
                <p className="mt-1 text-xs text-white/45">
                  Inspect a processed review example without sending text to a provider.
                </p>
                <button
                  type="button"
                  className={`${importGhostButton} mt-3`}
                  onClick={() => void openDevelopmentFixture()}
                  data-testid="open-import-review-fixture"
                >
                  Open review example
                </button>
              </section>
            ) : null}
          </div>
        ) : null}

        {phase === "creating" ? (
          <section className={`${importPanelClass} mx-auto max-w-3xl`} aria-live="polite">
            <p className="text-sm font-semibold">Saving private source…</p>
            <p className="mt-1 text-xs text-white/50">
              {entryMode === "url"
                ? "Retrieving one public page without cookies or browser access. Nothing is being published."
                : "Nothing is being published."}
            </p>
            <div className="ui-skeleton mt-5 h-3 w-2/3 rounded-full" />
          </section>
        ) : null}

        {phase === "processing" && draft ? (
          <section className={`${importPanelClass} mx-auto max-w-3xl`} aria-live="polite">
            <p className="text-sm font-semibold">
              {draft.processing_status === "processing_failed"
                ? "We couldn’t prepare this import"
                : draft.processing_status === "awaiting_processing"
                  ? "Ready to process"
                  : "Preparing private suggestions…"}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-white/55">
              The source and machine output remain private. You will review each result
              before anything can enter a native job draft.
            </p>
            {draft.processing_status === "processing" ? (
              <div className="ui-skeleton mt-5 h-3 w-2/3 rounded-full" />
            ) : null}
            {error ? (
              <p role="alert" className="mt-3 text-sm text-amber-200/90">
                {error}
              </p>
            ) : null}
            {draft.processing_status !== "processing" ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={importPrimaryButton}
                  onClick={() => void processDraft(draft)}
                >
                  {draft.processing_status === "processing_failed"
                    ? "Retry processing"
                    : "Start processing"}
                </button>
                <button
                  type="button"
                  className={importGhostButton}
                  onClick={() => setConfirmStartOver(true)}
                >
                  Start over
                </button>
                {isDevelopmentRuntime ? (
                  <button
                    type="button"
                    className={importGhostButton}
                    onClick={() => void openDevelopmentFixture()}
                  >
                    Open review example
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {phase === "source_summary" && draft ? (
          <section className={`${importPanelClass} mx-auto max-w-3xl`}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">
              Private source
            </p>
            <h2 className="mt-2 text-lg font-semibold">Import source summary</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-white/45">Type</dt>
                <dd className="mt-1 text-white/80">
                  {source?.source_type === "public_url"
                    ? "Public URL normalized to private text"
                    : "Pasted or normalized text"}
                </dd>
              </div>
              <div>
                <dt className="text-white/45">Processing</dt>
                <dd className="mt-1 text-white/80">
                  {draft.processing_status.replaceAll("_", " ")}
                </dd>
              </div>
              <div>
                <dt className="text-white/45">Fields found</dt>
                <dd className="mt-1 text-white/80">
                  {draft.fields.filter((field) => field.provenance_state !== "missing").length}
                </dd>
              </div>
              <div>
                <dt className="text-white/45">Privacy</dt>
                <dd className="mt-1 text-white/80">Only visible to your account</dd>
              </div>
              {source?.source_type === "public_url" && source.final_source_url ? (
                <div className="sm:col-span-2">
                  <dt className="text-white/45">Retrieved page</dt>
                  <dd className="mt-1 break-all text-white/80">
                    {source.final_source_url}
                  </dd>
                </div>
              ) : null}
            </dl>
            <button
              type="button"
              className={`${importPrimaryButton} mt-5`}
              onClick={() => setPhase("review")}
            >
              Return to review
            </button>
          </section>
        ) : null}

        {phase === "review" && draft ? (
          <ImportReviewWorkspace
            draft={draft}
            busyField={busyField}
            applying={applying}
            error={error}
            onAction={reviewAction}
            onApply={applyDraft}
            onSourceSummary={() => setPhase("source_summary")}
            onStartOver={() => setConfirmStartOver(true)}
          />
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmStartOver}
        title="Start a new import?"
        body="This preserves the current private audit record and starts a fresh import."
        confirmLabel="Start over"
        destructive
        onConfirm={() => void startOver()}
        onCancel={() => setConfirmStartOver(false)}
      />
    </main>
  );
}
