"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Job } from "../../lib/types";
import {
  applyToJob,
  createReport,
  describeActionError,
  isBackendAuthError,
  listMyPortfolio,
  listRoles,
  previewPortfolioLink,
  saveJob,
  type BackendPortfolioItem,
  type BackendRole,
  type ReportCategory,
} from "../../lib/backendClient";
import ReportDialog from "../ReportDialog";
import {
  CUSTOM_INSTRUCTION_REQUIREMENT_KEY,
  FirstMessageAnswers,
  isPortfolioAnswer,
  normalizeFirstMessageAnswers,
  sanitizeRequirementKeys,
  validateAnswers,
} from "../../lib/firstMessageRequirements";
import { toPortfolioOption, toPortfolioOptions } from "../../lib/firstMessagePortfolio";
import type { PortfolioState } from "../first-message/FirstMessageFields";
import ActionSuccessModal from "../first-message/ActionSuccessModal";
import FirstMessageRequirementsModal from "../first-message/FirstMessageRequirementsModal";
import AddWorkSampleChoiceModal, { type WorkSampleAction } from "../you/AddWorkSampleChoiceModal";
import PortfolioProjectWorkspace from "../you/PortfolioProjectWorkspace";
import JobActionsPanel from "./JobActionsPanel";

export default function JobActionsPanelClient({
  job,
  isOwner = false,
}: {
  job: Job;
  isOwner?: boolean;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [applyState, setApplyState] = React.useState<"idle" | "saving" | "sent" | "error">("idle");
  const [applyError, setApplyError] = React.useState<string | null>(null);
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [reportState, setReportState] = React.useState<"idle" | "sending" | "sent" | "error">("idle");
  const [shareState, setShareState] = React.useState<"idle" | "copied">("idle");

  const requirementKeys = React.useMemo(
    () => sanitizeRequirementKeys(job.applicationRequirements, "job"),
    [job.applicationRequirements]
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
  const [portfolio, setPortfolio] = React.useState<PortfolioState | undefined>(
    needsPortfolio ? { items: [], loading: true } : undefined
  );

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

  const onAnswersChange = (next: FirstMessageAnswers) => {
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
      setSaveError(describeActionError(err, "Couldn’t save this job right now."));
    }
  };

  // Apply click: if the owner set first-message requirements, open the completion
  // modal (the modal becomes the submission step). With no requirements, the apply
  // proceeds immediately as before. Opening the modal does not require a session —
  // the requester can see and fill what's asked; auth is enforced at submit.
  const onApply = async () => {
    if (requirementKeys.length) {
      setApplyState("idle");
      setApplyError(null);
      setRequirementsOpen(true);
      return;
    }
    await submitApplication();
  };

  const submitApplication = async () => {
    // Hard block: never submit until every required first-message detail is complete.
    // Validate before auth so an incomplete attempt shows calm inline guidance
    // instead of bouncing a signed-out requester to the login screen.
    if (requirementKeys.length) {
      const normalizedAnswers = normalizeFirstMessageAnswers(requirementKeys, "job", answers, requirementPrompts);
      const errors = validateAnswers(requirementKeys, "job", normalizedAnswers);
      if (Object.keys(errors).length) {
        setAnswerErrors(errors);
        setApplyState("idle");
        return;
      }
      if (JSON.stringify(normalizedAnswers) !== JSON.stringify(answers)) {
        setAnswers(normalizedAnswers);
      }
    }
    const token = requireToken();
    if (!token) return;
    setApplyState("saving");
    setApplyError(null);
    try {
      // Link any selected real portfolio items so the backend records them too.
      const normalizedAnswers = requirementKeys.length
        ? normalizeFirstMessageAnswers(requirementKeys, "job", answers, requirementPrompts)
        : {};
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
        ...(requirementKeys.length ? { first_message_answers: normalizedAnswers } : {}),
      });
      setConversationId(application.id);
      setApplyState("sent");
      setRequirementsOpen(false);
      setSuccessOpen(true);
    } catch (err) {
      console.error("Apply to job failed:", err);
      setApplyState("error");
      setApplyError(describeActionError(err, "Couldn’t send the application. Try again."));
      // Expired/invalid session: send them to sign in again so a retry can work.
      if (isBackendAuthError(err)) loginRedirect();
    }
  };

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
            `/applications?view=talent${conversationId ? `&thread=${encodeURIComponent(conversationId)}` : ""}`
          )
        }
        onSecondary={() => setSuccessOpen(false)}
        onClose={() => setSuccessOpen(false)}
      />
    </>
  );
}
