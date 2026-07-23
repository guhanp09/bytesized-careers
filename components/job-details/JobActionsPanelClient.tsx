"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Job } from "../../lib/types";
import {
  applicationPreflightForJob,
  validateUnknownRequirementAnswers,
} from "../../lib/jobApplication";
import {
  BackendRequestError,
  applyToJob,
  createReport,
  getMyApplicationForJob,
  isBackendAuthError,
  isBackendUnreachableError,
  listMyPortfolio,
  listRoles,
  previewPortfolioLink,
  saveJob,
  type BackendPortfolioItem,
  type BackendJobApplication,
  type BackendRole,
  type ReportCategory,
} from "../../lib/backendClient";
import ReportDialog from "../ReportDialog";
import {
  CUSTOM_INSTRUCTION_REQUIREMENT_KEY,
  FirstMessageAnswers,
  isPortfolioAnswer,
  normalizeFirstMessageAnswers,
  validateAnswers,
} from "../../lib/firstMessageRequirements";
import { toPortfolioOption, toPortfolioOptions } from "../../lib/firstMessagePortfolio";
import { applicationRelationshipPresentation } from "../../lib/applicationRelationship";
import type { PortfolioState } from "../first-message/FirstMessageFields";
import ActionSuccessModal from "../first-message/ActionSuccessModal";
import FirstMessageRequirementsModal from "../first-message/FirstMessageRequirementsModal";
import AddWorkSampleChoiceModal, { type WorkSampleAction } from "../you/AddWorkSampleChoiceModal";
import PortfolioProjectWorkspace from "../you/PortfolioProjectWorkspace";
import JobActionsPanel from "./JobActionsPanel";

const applicationErrorMessage = (
  error: unknown,
  fallback = "Couldn’t send the application. Try again.",
) => {
  if (isBackendAuthError(error)) return "Your session has expired. Sign in again to continue.";
  if (isBackendUnreachableError(error)) {
    return "CreatorJobs can’t connect right now. Check your connection and try again.";
  }
  if (error instanceof BackendRequestError) {
    const message = error.message.toLowerCase();
    if (message.includes("deadline")) return "The application deadline for this job has passed.";
    if (message.includes("external site")) {
      return "This listing now uses an external application flow. Reload the page to continue.";
    }
    if (message.includes("not accepting applications") || message.includes("unavailable for direct interaction")) {
      return "This job is no longer accepting applications.";
    }
    if (error.status === 403) return "This application action isn’t available.";
    if (error.status === 404) return "This job is no longer available.";
    if (error.status === 422) return "Review the requested application details and try again.";
  }
  return fallback;
};

const applicationFieldErrors = (error: unknown) => {
  if (!(error instanceof BackendRequestError) || !error.fieldErrors) return {};
  const errors: Record<string, string> = {};
  for (const field of Object.keys(error.fieldErrors)) {
    const requirementMatch = field.match(/^first_message_answers\.([^.]+)$/);
    if (requirementMatch) errors[requirementMatch[1]] = "Complete this requested detail.";
  }
  return errors;
};

const applicationBecameUnavailable = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("not accepting applications") ||
    message.includes("unavailable for direct interaction") ||
    message.includes("external site")
  );
};

export default function JobActionsPanelClient({
  job,
  isOwner = false,
}: {
  job: Job;
  isOwner?: boolean;
}) {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const [applyState, setApplyState] = React.useState<"idle" | "saving" | "sent" | "error">("idle");
  const [applyError, setApplyError] = React.useState<string | null>(null);
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [reportState, setReportState] = React.useState<"idle" | "sending" | "sent" | "error">("idle");
  const [shareState, setShareState] = React.useState<"idle" | "copied">("idle");

  const preflight = React.useMemo(() => applicationPreflightForJob(job), [job]);
  const requirementKeys = preflight.knownRequirementKeys;
  const unknownRequirementKeys = preflight.unknownRequirementKeys;
  const preflightNotice = React.useMemo(
    () =>
      [
        preflight.deadline.valid ? preflight.deadline.label : null,
        preflight.trial
          ? [preflight.trial.title, ...preflight.trial.details].filter(Boolean).join(" · ")
          : null,
        preflight.applicationInstruction
          ? `Application instructions: ${preflight.applicationInstruction}`
          : null,
      ]
        .filter(Boolean)
        .join(". "),
    [preflight],
  );
  const requirementPrompts = React.useMemo(() => {
    const customInstruction = job.howToApply?.trim();
    if (!customInstruction || !requirementKeys.includes(CUSTOM_INSTRUCTION_REQUIREMENT_KEY)) {
      return undefined;
    }
    return { [CUSTOM_INSTRUCTION_REQUIREMENT_KEY]: customInstruction };
  }, [job.howToApply, requirementKeys]);
  const needsPortfolio = requirementKeys.includes("relevant_portfolio");
  const [answers, setAnswers] = React.useState<FirstMessageAnswers>({});
  const [answerErrors, setAnswerErrors] = React.useState<Record<string, string>>({});
  const [requirementsOpen, setRequirementsOpen] = React.useState(false);
  const [successOpen, setSuccessOpen] = React.useState(false);
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [existingApplication, setExistingApplication] = React.useState<BackendJobApplication | null>(null);
  const [relationshipState, setRelationshipState] = React.useState<"loading" | "ready" | "error">(
    isOwner ? "ready" : "loading"
  );
  const [relationshipReload, setRelationshipReload] = React.useState(0);
  const [portfolio, setPortfolio] = React.useState<PortfolioState | undefined>(
    needsPortfolio ? { items: [], loading: true } : undefined
  );
  const [deadlineExpired, setDeadlineExpired] = React.useState(preflight.deadline.expired);
  const [applicationsUnavailable, setApplicationsUnavailable] = React.useState(false);

  React.useEffect(() => {
    setApplicationsUnavailable(false);
  }, [job.id]);

  React.useEffect(() => {
    setDeadlineExpired(preflight.deadline.expired);
    if (!preflight.deadline.valid || preflight.deadline.expired || !job.deadlineAt) return;
    const update = () => setDeadlineExpired(new Date(job.deadlineAt as string).getTime() <= Date.now());
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, [job.deadlineAt, preflight.deadline.expired, preflight.deadline.valid]);

  // Load the requester's real profile portfolio so a "relevant portfolio"
  // requirement links to actual items, not faked entries.
  React.useEffect(() => {
    if (!needsPortfolio) return;
    const token = session?.backendAccessToken;
    if (!token) {
      // No session yet: drop the loading state so the picker shows its empty
      // state (attach a link) instead of spinning forever.
      setPortfolio({ items: [], loading: false });
      return;
    }
    let mounted = true;
    setPortfolio({ items: [], loading: true });
    void listMyPortfolio(token)
      .then((response) => {
        if (!mounted) return;
        setPortfolio({ items: toPortfolioOptions(response.items), loading: false });
      })
      .catch(() => {
        if (!mounted) return;
        setPortfolio({ items: [], loading: false, error: "Couldn’t load your portfolio." });
      });
    return () => {
      mounted = false;
    };
  }, [needsPortfolio, session?.backendAccessToken]);

  const [addProjectOpen, setAddProjectOpen] = React.useState(false);
  const addProjectOpenerRef = React.useRef<HTMLElement | null>(null);
  // When set, the FULL project builder (the real /you/portfolio wizard) is open
  // in-flow, seeded from the URL-entry step the requester just completed.
  const [builderLaunch, setBuilderLaunch] = React.useState<WorkSampleAction | null>(null);
  const [rolesCatalog, setRolesCatalog] = React.useState<BackendRole[]>([]);

  const onAnswersChange = (next: React.SetStateAction<FirstMessageAnswers>) => {
    setAnswers(next);
    if (Object.keys(answerErrors).length) setAnswerErrors({});
  };

  // ── In-flow "Add project to portfolio" ────────────────────────────────────
  // Adding a portfolio item from the apply popup creates a *real* profile portfolio
  // project and auto-selects it — without navigating away or losing any answers.
  // It reuses the same Add Project (URL) modal the /you portfolio uses.
  const previewAddProjectLink = React.useCallback(
    (url: string) => {
      const token = session?.backendAccessToken;
      if (!token) return Promise.reject(new Error("Sign in to add a project."));
      return previewPortfolioLink(token, url);
    },
    [session?.backendAccessToken]
  );

  const openAddProject = () => {
    if (!session?.backendAccessToken) {
      loginRedirect();
      return;
    }
    // Remember the trigger so focus returns to the portfolio section on close.
    addProjectOpenerRef.current = (document.activeElement as HTMLElement | null) ?? null;
    setAddProjectOpen(true);
  };

  const closeAddProject = () => {
    setAddProjectOpen(false);
    window.setTimeout(() => addProjectOpenerRef.current?.focus?.(), 0);
  };

  // The URL-entry step is the project builder's own first step: once the requester
  // picks a source, hand off to the FULL builder (the real /you/portfolio wizard,
  // reused in-flow) so they can complete every project detail — including the role
  // the backend needs to *publish* a recruiter-visible project — and return here with
  // it auto-selected. No navigation, no draft shortcut, no lost answers.
  const handleAddProjectChoose = (action: WorkSampleAction) => {
    if (!session?.backendAccessToken) {
      setAddProjectOpen(false);
      loginRedirect();
      return;
    }
    setAddProjectOpen(false);
    setBuilderLaunch(action);
  };

  // The builder expects a "fresh token" wrapper; the apply flow runs requests with the
  // active NextAuth backend token. Stable identity keeps the builder's launch effect
  // from re-firing (which would reopen the editor) on host re-renders.
  const withFreshBackendToken = React.useCallback(
    async <T,>(request: (token: string) => Promise<T>): Promise<T> => {
      const token = session?.backendAccessToken;
      if (!token) throw new Error("Sign in to add a project.");
      return request(token);
    },
    [session?.backendAccessToken]
  );

  // Lazily load the role catalog the builder uses for role suggestions (best-effort;
  // the role field still works as free text if this fails).
  React.useEffect(() => {
    if (!builderLaunch || rolesCatalog.length) return;
    let mounted = true;
    void listRoles()
      .then((res) => {
        if (mounted) setRolesCatalog(res.items || []);
      })
      .catch(() => {
        /* role suggestions are optional */
      });
    return () => {
      mounted = false;
    };
  }, [builderLaunch, rolesCatalog.length]);

  const closeBuilder = React.useCallback(() => {
    setBuilderLaunch(null);
    window.setTimeout(() => addProjectOpenerRef.current?.focus?.(), 0);
  }, []);

  // Stable no-op / error sinks so the builder's effects keep a constant dependency set.
  const noopLaunchHandled = React.useCallback(() => {}, []);
  const noopRefreshCompletion = React.useCallback(async () => {}, []);
  const handleBuilderError = React.useCallback((message: string | null) => {
    setPortfolio((prev) => ({ items: prev?.items ?? [], loading: false, error: message }));
  }, []);

  // Keep the picker in sync with the requester's real portfolio after any builder save.
  const handleBuilderPortfolioChange = React.useCallback((items: BackendPortfolioItem[]) => {
    setPortfolio((prev) => ({
      ...(prev ?? { items: [], loading: false }),
      items: toPortfolioOptions(items),
      loading: false,
      error: null,
    }));
  }, []);

  // The builder saved a new project: surface it in the picker and auto-select it,
  // preserving every other already-filled answer, then close the builder.
  const handleBuilderProjectCreated = React.useCallback(
    (item: BackendPortfolioItem) => {
      const option = toPortfolioOption(item);
      setPortfolio((prev) => {
        const base = prev ?? { items: [], loading: false };
        if (base.items.some((existing) => existing.id === option.id)) return { ...base, error: null };
        return { ...base, items: [option, ...base.items], loading: false, error: null };
      });
      setAnswers((prev) => {
        const existing = isPortfolioAnswer(prev.relevant_portfolio) ? prev.relevant_portfolio : [];
        if (existing.some((ref) => ref.id === option.id)) return prev;
        return {
          ...prev,
          relevant_portfolio: [...existing, { id: option.id, title: option.title, url: option.url }],
        };
      });
      if (Object.keys(answerErrors).length) setAnswerErrors({});
      closeBuilder();
    },
    [answerErrors, closeBuilder]
  );

  // The picker offers in-flow project creation only when we can actually persist it
  // (signed in); signed-out requesters keep the link-attach fallback.
  const portfolioForModal: PortfolioState | undefined = needsPortfolio
    ? {
        ...(portfolio ?? { items: [], loading: false }),
        ...(session?.backendAccessToken ? { onAddProject: openAddProject } : {}),
      }
    : portfolio;

  const loginRedirect = () =>
    router.push(`/auth?mode=login&next=${encodeURIComponent(`/jobs/${job.id}`)}`);

  React.useEffect(() => {
    if (isOwner) {
      setExistingApplication(null);
      setConversationId(null);
      setApplyState("idle");
      setApplyError(null);
      setRelationshipState("ready");
      return;
    }
    if (sessionStatus === "loading") {
      setRelationshipState(preflight.mode === "external" ? "ready" : "loading");
      return;
    }
    const token = session?.backendAccessToken;
    if (!token) {
      setExistingApplication(null);
      setConversationId(null);
      setApplyState("idle");
      setApplyError(null);
      setRelationshipState("ready");
      return;
    }
    let cancelled = false;
    setExistingApplication(null);
    setConversationId(null);
    setRelationshipState(preflight.mode === "external" ? "ready" : "loading");
    setApplyState("idle");
    setApplyError(null);
    void getMyApplicationForJob(token, String(job.id))
      .then((application) => {
        if (cancelled) return;
        setExistingApplication(application);
        setConversationId(application?.id ?? null);
        setApplyState("idle");
        setApplyError(null);
        setRelationshipState("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        if (preflight.mode === "external") {
          // Existing CreatorJobs applications remain discoverable after a listing
          // switches to an external flow, but a failed relationship read must not
          // block or replace the safe external link.
          setRelationshipState("ready");
          return;
        }
        setRelationshipState("error");
        setApplyState("error");
        setApplyError(applicationErrorMessage(error, "Couldn’t check your application status. Try again."));
      });
    return () => {
      cancelled = true;
    };
  }, [isOwner, job.id, preflight.mode, relationshipReload, session?.backendAccessToken, sessionStatus]);

  const openApplication = (applicationId: string) => {
    router.push(
      `/applications?view=inbox&mode=talent&thread=${encodeURIComponent(applicationId)}`
    );
  };

  const requireToken = () => {
    const token = session?.backendAccessToken;
    if (!token) {
      loginRedirect();
      return null;
    }
    return token;
  };

  const onShare = async () => {
    try {
      const url = typeof window !== "undefined" ? `${window.location.origin}/jobs/${job.id}` : "";
      if (!url) return;
      await navigator.clipboard?.writeText(url);
      setShareState("copied");
      window.setTimeout(() => setShareState("idle"), 1800);
    } catch {
      // Clipboard failure is non-critical; sharing remains available through the URL.
    }
  };

  const onSave = async () => {
    const token = requireToken();
    if (!token) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      await saveJob(token, String(job.id));
      setSaveState("saved");
    } catch (err) {
      console.error("Save job failed:", err);
      setSaveState("error");
      setSaveError(applicationErrorMessage(err, "Couldn’t save this job right now."));
    }
  };

  // Apply click: require sign-in before the candidate starts composing so an auth
  // redirect cannot discard answers. Listing requirements remain visible on the
  // detail page before this point. The modal becomes the submission step when the
  // listing asks for preflight details.
  const onApply = async () => {
    if (deadlineExpired || applicationsUnavailable) return;
    if (preflight.mode === "external") return;
    if (existingApplication) {
      openApplication(existingApplication.id);
      return;
    }
    if (relationshipState === "loading") return;
    if (relationshipState === "error") {
      setApplyState("idle");
      setRelationshipReload((value) => value + 1);
      return;
    }
    if (!session?.backendAccessToken) {
      loginRedirect();
      return;
    }
    if (preflight.hasPreflightDetails) {
      setApplyState("idle");
      setApplyError(null);
      setRequirementsOpen(true);
      return;
    }
    await submitApplication();
  };

  const submitApplication = async () => {
    // A stale open modal must never turn an external or newly unavailable listing
    // into an internal CreatorJobs POST.
    if (preflight.mode === "external" || applicationsUnavailable) {
      setRequirementsOpen(false);
      return;
    }
    // Hard block: never submit until every required first-message detail is complete.
    // Validate before auth so an incomplete attempt shows calm inline guidance
    // instead of bouncing a signed-out requester to the login screen.
    if (requirementKeys.length || unknownRequirementKeys.length) {
      const normalizedAnswers = normalizeFirstMessageAnswers(requirementKeys, "job", answers, requirementPrompts);
      for (const key of unknownRequirementKeys) {
        if (typeof answers[key] === "string") normalizedAnswers[key] = answers[key];
      }
      const errors = {
        ...validateAnswers(requirementKeys, "job", normalizedAnswers),
        ...validateUnknownRequirementAnswers(unknownRequirementKeys, answers),
      };
      if (Object.keys(errors).length) {
        setAnswerErrors(errors);
        setApplyState("idle");
        return;
      }
      if (JSON.stringify(normalizedAnswers) !== JSON.stringify(answers)) {
        setAnswers(normalizedAnswers);
      }
    }
    if (deadlineExpired) {
      setApplyState("error");
      setApplyError("The application deadline for this job has passed.");
      return;
    }
    const token = requireToken();
    if (!token) return;
    setApplyState("saving");
    setApplyError(null);
    try {
      // Link any selected real portfolio items so the backend records them too.
      const normalizedAnswers = normalizeFirstMessageAnswers(requirementKeys, "job", answers, requirementPrompts);
      for (const key of unknownRequirementKeys) {
        if (typeof answers[key] === "string") normalizedAnswers[key] = answers[key].trim();
      }
      const portfolioAnswer = normalizedAnswers.relevant_portfolio;
      const portfolioItemIds = isPortfolioAnswer(portfolioAnswer)
        ? portfolioAnswer.map((ref) => ref.id).filter((id) => !id.startsWith("link:"))
        : [];
      // The inbox creates the opening system event. Structured requirement
      // answers render as the first-message summary; no-requirement applications
      // should not create an extra generated text bubble.
      // The backend is idempotent: a repeat apply returns the existing record, so
      // its id always points at the one conversation this application created.
      const application = await applyToJob(token, String(job.id), {
        cover_note: null,
        ...(portfolioItemIds.length ? { portfolio_item_ids: portfolioItemIds } : {}),
        ...(Object.keys(normalizedAnswers).length ? { first_message_answers: normalizedAnswers } : {}),
      });
      setExistingApplication(application);
      setConversationId(application.id);
      setApplyState("sent");
      setRequirementsOpen(false);
      setSuccessOpen(true);
    } catch (err) {
      console.error("Apply to job failed:", err);
      setApplyState("error");
      setApplyError(applicationErrorMessage(err));
      const serverFieldErrors = applicationFieldErrors(err);
      if (Object.keys(serverFieldErrors).length) setAnswerErrors(serverFieldErrors);
      if (err instanceof Error && err.message.toLowerCase().includes("deadline")) {
        setDeadlineExpired(true);
        setRequirementsOpen(false);
      } else if (applicationBecameUnavailable(err)) {
        setApplicationsUnavailable(true);
        setRequirementsOpen(false);
      }
      // Expired/invalid session: send them to sign in again so a retry can work.
      if (isBackendAuthError(err)) loginRedirect();
    }
  };

  const applicationPresentation = existingApplication
    ? applicationRelationshipPresentation(existingApplication.status)
    : null;
  const primaryAction = existingApplication
    ? {
        label: applicationPresentation?.actionLabel ?? "Open conversation",
        icon: "inbox" as const,
      }
    : deadlineExpired
      ? { label: "Applications closed", icon: "calendar-clock" as const, disabled: true }
      : applicationsUnavailable
        ? { label: "Applications unavailable", icon: "alert" as const, disabled: true }
      : preflight.mode === "external" && preflight.externalUrl
        ? { label: "Continue to application", icon: "external-link" as const, href: preflight.externalUrl, external: true }
        : preflight.mode === "external"
          ? { label: "Application link unavailable", icon: "alert" as const, disabled: true }
    : relationshipState === "loading"
      ? { label: "Checking application…", icon: "refresh" as const, disabled: true }
      : relationshipState === "error"
        ? { label: "Retry", icon: "refresh" as const }
        : undefined;

  // "Report this listing" opens the shared reason picker; the report itself is
  // submitted from the dialog with the chosen category + optional note.
  const [reportOpen, setReportOpen] = React.useState(false);
  const onReport = () => {
    if (reportState === "sent") return;
    setReportOpen(true);
  };

  const submitReport = async (category: ReportCategory, note: string | null) => {
    if (reportState === "sending") return;
    setReportState("sending");
    try {
      await createReport(
        { target_type: "job", target_id: String(job.id), category, note },
        session?.backendAccessToken
      );
      setReportState("sent");
      setReportOpen(false);
    } catch {
      setReportState("error");
    }
  };

  return (
    <>
      <JobActionsPanel
        job={job}
        onShare={onShare}
        onSave={onSave}
        onApply={onApply}
        onReport={onReport}
        saveState={saveState}
        applyState={applyState}
        applyError={applyError}
        saveError={saveError}
        reportState={reportState}
        shareState={shareState}
        isOwner={isOwner}
        primaryAction={primaryAction}
        applicationStatusLabel={applicationPresentation?.statusLabel ?? null}
        applicationMode={preflight.mode}
        applicationNotice={
          existingApplication
            ? "Your CreatorJobs application already exists. Open its conversation to continue."
            : deadlineExpired
            ? "The application deadline has passed."
            : applicationsUnavailable
              ? "This job is no longer accepting applications."
            : preflight.mode === "external"
              ? "This opens another site. CreatorJobs does not receive or track the application."
              : null
        }
      />
      <FirstMessageRequirementsModal
        open={requirementsOpen}
        context="job"
        requirementKeys={requirementKeys}
        answers={answers}
        onAnswersChange={onAnswersChange}
        errors={answerErrors}
        portfolio={portfolioForModal}
        requirementPrompts={requirementPrompts}
        onSubmit={submitApplication}
        onClose={() => setRequirementsOpen(false)}
        submitState={applyState}
        submitError={applyError}
        unknownRequirementKeys={unknownRequirementKeys}
        preflightNotice={preflightNotice || null}
        currencyCode={job.budgetCurrency}
      />
      {addProjectOpen && typeof document !== "undefined"
        ? createPortal(
            <AddWorkSampleChoiceModal
              elevated
              onClose={closeAddProject}
              onChoose={handleAddProjectChoose}
              onPreviewLink={previewAddProjectLink}
            />,
            document.body
          )
        : null}
      {builderLaunch && typeof document !== "undefined"
        ? createPortal(
            <PortfolioProjectWorkspace
              embedded
              portfolio={[]}
              rolesCatalog={rolesCatalog}
              withFreshBackendToken={withFreshBackendToken}
              onPortfolioChange={handleBuilderPortfolioChange}
              onRefreshProfileCompletion={noopRefreshCompletion}
              setGlobalError={handleBuilderError}
              launchSource={builderLaunch.sourceType}
              launchSourceKind={builderLaunch.sourceKind}
              launchSourceUrl={builderLaunch.url}
              launchSuggestedTitle={builderLaunch.suggestedTitle || ""}
              launchLinkPreview={builderLaunch.preview ?? null}
              launchPreviewError={builderLaunch.previewError || ""}
              onLaunchHandled={noopLaunchHandled}
              onProjectCreated={handleBuilderProjectCreated}
              onClose={closeBuilder}
            />,
            document.body
          )
        : null}
      <ReportDialog
        open={reportOpen}
        targetLabel="this job"
        sending={reportState === "sending"}
        error={reportState === "error" ? "Couldn’t send the report. Try again." : null}
        onSubmit={(category, note) => void submitReport(category, note)}
        onClose={() => setReportOpen(false)}
      />
      <ActionSuccessModal
        open={successOpen}
        title="Application sent"
        body="Your application has been shared with the hiring team."
        primaryLabel="Open conversation"
        secondaryLabel="Keep browsing jobs"
        testid="apply-success-modal"
        onPrimary={() =>
          // A sent application surfaces in the applicant's Talent inbox; deep-link
          // straight to its thread.
          router.push(
            `/applications?view=inbox&mode=talent${conversationId ? `&thread=${encodeURIComponent(conversationId)}` : ""}`
          )
        }
        onSecondary={() => setSuccessOpen(false)}
        onClose={() => setSuccessOpen(false)}
      />
    </>
  );
}
