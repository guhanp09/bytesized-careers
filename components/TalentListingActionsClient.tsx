"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Icon } from "./Icons";
import {
  createReport,
  describeActionError,
  getMyTalentInterestForListing,
  isBackendAuthError,
  saveTalentListing,
  sendTalentInterest,
  type BackendTalentInterest,
  type ReportCategory,
} from "../lib/backendClient";
import { talentInterestRelationshipPresentation } from "../lib/applicationRelationship";
import {
  CUSTOM_INSTRUCTION_REQUIREMENT_KEY,
  FirstMessageAnswers,
  normalizeFirstMessageAnswers,
  sanitizeRequirementKeys,
  validateAnswers,
} from "../lib/firstMessageRequirements";
import ActionSuccessModal from "./first-message/ActionSuccessModal";
import FirstMessageRequirementsModal from "./first-message/FirstMessageRequirementsModal";
import ReportDialog from "./ReportDialog";
import { Section, ToolChip } from "./ui";

type ActionState = "idle" | "saving" | "sent" | "error";
type TalentMetadataRow = { label: string; values: string[] };

// Secondary action buttons (Save / Share): clearly pressable — filled surface
// with a subtle lift + shadow — but deliberately subordinate to the solid white
// primary (Hire Me).
const SECONDARY_ACTION_CLASS =
  "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.08] text-sm font-semibold text-white/85 shadow-[0_10px_26px_-20px_rgba(0,0,0,0.95)] transition-all duration-150 hover:-translate-y-[1px] hover:border-white/25 hover:bg-white/[0.13] hover:text-white active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 disabled:cursor-not-allowed disabled:opacity-60";

function TalentMetadataCard({
  rows,
  tools,
}: {
  rows: TalentMetadataRow[];
  tools: string[];
}) {
  const visibleRows = rows
    .map((row) => ({
      ...row,
      values: row.values.map((value) => value.trim()).filter(Boolean),
    }))
    .filter((row) => row.values.length > 0);
  const visibleTools = tools.map((tool) => tool.trim()).filter(Boolean);

  if (!visibleRows.length && !visibleTools.length) {
    return null;
  }

  return (
    <section
      data-testid="talent-metadata-card"
      aria-label="Talent listing metadata"
      className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.06] p-5 shadow-[0_10px_30px_-20px_rgba(0,0,0,0.9)]"
    >
      <div className="space-y-4">
        {visibleRows.map((row) => (
          <div key={row.label} className="min-w-0 space-y-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle">
              {row.label}
            </div>
            <div className="flex min-w-0 flex-wrap gap-2">
              {row.values.map((value) => (
                <span
                  key={`${row.label}-${value}`}
                  className="max-w-full break-words rounded-full border border-white/[0.09] bg-white/[0.04] px-3 py-1.5 text-xs font-medium leading-relaxed text-white/64"
                >
                  {value}
                </span>
              ))}
            </div>
          </div>
        ))}

        {visibleTools.length ? (
          <div className="min-w-0 space-y-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle">
              Tools
            </div>
            <div className="flex min-w-0 flex-wrap gap-2">
              {visibleTools.map((tool) => (
                <ToolChip key={`talent-tool-${tool}`} toolName={tool} size="sm" />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default function TalentListingActionsClient({
  listingId,
  requirementKeys = [],
  customInstructionPrompt = null,
  metadataRows = [],
  tools = [],
}: {
  listingId: string;
  requirementKeys?: string[];
  customInstructionPrompt?: string | null;
  metadataRows?: TalentMetadataRow[];
  tools?: string[];
}) {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const [saveState, setSaveState] = React.useState<ActionState>("idle");
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [interestState, setInterestState] = React.useState<ActionState>("idle");
  const [interestError, setInterestError] = React.useState<string | null>(null);
  const [reportState, setReportState] = React.useState<ActionState>("idle");
  const [shareState, setShareState] = React.useState<"idle" | "copied">("idle");

  const keys = React.useMemo(
    () => sanitizeRequirementKeys(requirementKeys, "talent"),
    [requirementKeys]
  );
  const requirementPrompts = React.useMemo(() => {
    const prompt = customInstructionPrompt?.trim();
    if (!prompt || !keys.includes(CUSTOM_INSTRUCTION_REQUIREMENT_KEY)) return undefined;
    return { [CUSTOM_INSTRUCTION_REQUIREMENT_KEY]: prompt };
  }, [customInstructionPrompt, keys]);
  const [answers, setAnswers] = React.useState<FirstMessageAnswers>({});
  const [answerErrors, setAnswerErrors] = React.useState<Record<string, string>>({});
  const [requirementsOpen, setRequirementsOpen] = React.useState(false);
  const [successOpen, setSuccessOpen] = React.useState(false);
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [existingInterest, setExistingInterest] = React.useState<BackendTalentInterest | null>(null);
  const [relationshipState, setRelationshipState] = React.useState<"loading" | "ready" | "error">("loading");
  const [relationshipReload, setRelationshipReload] = React.useState(0);

  const onAnswersChange = (next: React.SetStateAction<FirstMessageAnswers>) => {
    setAnswers(next);
    if (Object.keys(answerErrors).length) setAnswerErrors({});
  };

  const loginRedirect = () =>
    router.push(`/auth?mode=login&next=${encodeURIComponent(`/talent/${listingId}`)}`);

  const requireToken = () => {
    const token = session?.backendAccessToken;
    if (!token) {
      loginRedirect();
      return null;
    }
    return token;
  };

  React.useEffect(() => {
    if (sessionStatus === "loading") {
      setRelationshipState("loading");
      return;
    }
    const token = session?.backendAccessToken;
    if (!token) {
      setExistingInterest(null);
      setRelationshipState("ready");
      return;
    }
    let cancelled = false;
    setRelationshipState("loading");
    setInterestError(null);
    void getMyTalentInterestForListing(token, listingId)
      .then((interest) => {
        if (cancelled) return;
        setExistingInterest(interest);
        setConversationId(interest?.id ?? null);
        setInterestState("idle");
        setRelationshipState("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setRelationshipState("error");
        setInterestState("error");
        setInterestError(describeActionError(error, "Couldn’t check your hiring-request status. Try again."));
      });
    return () => {
      cancelled = true;
    };
  }, [listingId, relationshipReload, session?.backendAccessToken, sessionStatus]);

  const openInterest = (interestId: string) => {
    router.push(
      `/applications?view=inbox&mode=recruiter&thread=${encodeURIComponent(interestId)}`
    );
  };

  const saveListing = async () => {
    const token = requireToken();
    if (!token) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      await saveTalentListing(token, listingId);
      setSaveState("sent");
    } catch (err) {
      console.error("Save talent listing failed:", err);
      setSaveState("error");
      setSaveError(describeActionError(err, "Couldn’t save this listing right now."));
    }
  };

  // Hire click: when the talent set first-message requirements, open the completion
  // modal (the modal is the submission step). With no requirements, the request is
  // sent immediately. Opening the modal needs no session; auth is enforced at submit.
  const sendInterest = async () => {
    if (existingInterest) {
      openInterest(existingInterest.id);
      return;
    }
    if (relationshipState === "loading") return;
    if (relationshipState === "error") {
      setInterestState("idle");
      setRelationshipReload((value) => value + 1);
      return;
    }
    if (keys.length) {
      setInterestState("idle");
      setInterestError(null);
      setRequirementsOpen(true);
      return;
    }
    await submitInterest();
  };

  const submitInterest = async () => {
    // Hard block: never submit until every required first-message detail is complete.
    // Validate before auth so an incomplete attempt shows calm inline guidance
    // instead of bouncing a signed-out requester to the login screen.
    if (keys.length) {
      const normalizedAnswers = normalizeFirstMessageAnswers(keys, "talent", answers, requirementPrompts);
      const errors = validateAnswers(keys, "talent", normalizedAnswers);
      if (Object.keys(errors).length) {
        setAnswerErrors(errors);
        setInterestState("idle");
        return;
      }
    }
    const token = requireToken();
    if (!token) return;
    setInterestState("saving");
    setInterestError(null);
    try {
      const normalizedAnswers = keys.length
        ? normalizeFirstMessageAnswers(keys, "talent", answers, requirementPrompts)
        : undefined;
      // The inbox creates the opening system event. Structured requirement
      // answers render as the first-message summary; no-requirement requests
      // should not create an extra generated text bubble.
      // The backend reuses an existing active request, so the returned id always
      // points at the one conversation this hiring request created.
      const interest = await sendTalentInterest(
        token,
        listingId,
        null,
        null,
        normalizedAnswers
      );
      setExistingInterest(interest);
      setConversationId(interest.id);
      setInterestState("sent");
      setRequirementsOpen(false);
      setSuccessOpen(true);
    } catch (err) {
      console.error("Send talent interest failed:", err);
      setInterestState("error");
      setInterestError(describeActionError(err, "Couldn’t contact talent. Try again."));
      if (isBackendAuthError(err)) loginRedirect();
    }
  };

  const interestPresentation = existingInterest
    ? talentInterestRelationshipPresentation(existingInterest.status)
    : null;
  const primaryLabel = existingInterest
    ? interestPresentation?.actionLabel ?? "Open conversation"
    : relationshipState === "loading"
      ? "Checking request…"
      : relationshipState === "error"
        ? "Retry"
        : interestState === "saving"
          ? "Sending..."
          : "Hire Me";
  const primaryIcon = existingInterest
    ? "inbox"
    : relationshipState === "loading" || relationshipState === "error"
      ? "refresh"
      : "briefcase";

  const shareListing = async () => {
    try {
      const url = typeof window !== "undefined" ? `${window.location.origin}/talent/${listingId}` : "";
      if (!url) return;
      await navigator.clipboard?.writeText(url);
      setShareState("copied");
      window.setTimeout(() => setShareState("idle"), 1800);
    } catch {
      // Clipboard failure is non-critical; the URL remains shareable.
    }
  };

  // "Report this listing" opens the shared reason picker; the report submits
  // from the dialog with the chosen category + optional note.
  const [reportOpen, setReportOpen] = React.useState(false);
  const reportListing = () => {
    if (reportState === "sent") return;
    setReportOpen(true);
  };

  const submitReport = async (category: ReportCategory, note: string | null) => {
    if (reportState === "saving") return;
    setReportState("saving");
    try {
      await createReport(
        { target_type: "talent_listing", target_id: listingId, category, note },
        session?.backendAccessToken
      );
      setReportState("sent");
      setReportOpen(false);
    } catch {
      setReportState("error");
    }
  };

  return (
    <div className="space-y-6">
      <section
        data-testid="talent-action-card"
        className="rounded-3xl border border-white/[0.08] bg-white/[0.06] p-6 shadow-[0_18px_60px_-40px_rgba(0,0,0,0.95)]"
      >
        <button
          type="button"
          onClick={sendInterest}
          disabled={interestState === "saving" || relationshipState === "loading"}
          data-testid="talent-hire-button"
          className="inline-flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-white text-lg font-extrabold text-black shadow-[0_18px_40px_-28px_rgba(0,0,0,0.9)] transition-transform duration-150 hover:-translate-y-[1px] hover:bg-white/95 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-65"
        >
          <Icon name={primaryIcon} className="h-5 w-5" />
          {primaryLabel}
        </button>
        {interestState === "error" ? (
          <p className="mt-2 text-xs text-amber-200/80">{interestError || "Couldn’t contact talent. Try again."}</p>
        ) : null}
        {interestPresentation?.statusLabel ? (
          <p className="mt-2 text-xs text-muted">{interestPresentation.statusLabel}</p>
        ) : interestState === "sent" ? (
          <p className="mt-2 text-xs text-muted">
            Your hiring request is now visible in Inbox.
          </p>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={saveListing}
            disabled={saveState === "saving"}
            className={SECONDARY_ACTION_CLASS}
          >
            <Icon name="bookmark" className="h-4 w-4" />
            {saveState === "saving" ? "Saving..." : saveState === "sent" ? "Saved" : "Save"}
          </button>
          <button
            type="button"
            onClick={shareListing}
            className={SECONDARY_ACTION_CLASS}
          >
            <Icon name="share" className="h-4 w-4" />
            {shareState === "copied" ? "Copied" : "Share"}
          </button>
        </div>
        {saveState === "error" ? (
          <p className="mt-2 text-xs text-amber-200/80">{saveError || "Couldn’t save this listing right now."}</p>
        ) : null}
        {shareState === "copied" ? <p className="mt-2 text-xs text-muted">Link copied to your clipboard.</p> : null}
      </section>

      <TalentMetadataCard rows={metadataRows} tools={tools} />

      <div data-testid="talent-safety-card">
        <Section title="Safety & expectations" icon="shield" bodyClassName="mt-3 text-sm leading-relaxed text-white/80">
          Keep communication inside the platform, agree on scope, timeline, revisions, and payment terms before starting.
        </Section>
      </div>

      <div className="-mt-3 px-1">
        <button
          type="button"
          onClick={reportListing}
          disabled={reportState === "saving" || reportState === "sent"}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md text-xs font-semibold text-subtle underline-offset-4 transition hover:text-white/72 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/18 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0f] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon name="alert" className="h-3.5 w-3.5" />
          {reportState === "saving" ? "Reporting..." : reportState === "sent" ? "Reported" : "Report this listing"}
        </button>
        {reportState === "error" ? (
          <p className="mt-2 text-xs text-muted">Couldn’t send the report. Try again.</p>
        ) : null}
      </div>

      <FirstMessageRequirementsModal
        open={requirementsOpen}
        context="talent"
        requirementKeys={keys}
        answers={answers}
        onAnswersChange={onAnswersChange}
        errors={answerErrors}
        requirementPrompts={requirementPrompts}
        onSubmit={submitInterest}
        onClose={() => setRequirementsOpen(false)}
        submitState={interestState}
        submitError={interestError}
      />
      <ActionSuccessModal
        open={successOpen}
        title="Request sent"
        body="Your hiring request has been shared with the talent."
        primaryLabel="Open conversation"
        secondaryLabel="Keep browsing talent"
        testid="hire-success-modal"
        onPrimary={() =>
          // A sent hiring request surfaces in the requester's Recruiter inbox;
          // deep-link straight to its thread.
          router.push(
            `/applications?view=inbox&mode=recruiter${conversationId ? `&thread=${encodeURIComponent(conversationId)}` : ""}`
          )
        }
        onSecondary={() => setSuccessOpen(false)}
        onClose={() => setSuccessOpen(false)}
      />
      <ReportDialog
        open={reportOpen}
        targetLabel="this listing"
        sending={reportState === "saving"}
        error={reportState === "error" ? "Couldn’t send the report. Try again." : null}
        onSubmit={(category, note) => void submitReport(category, note)}
        onClose={() => setReportOpen(false)}
      />
    </div>
  );
}
