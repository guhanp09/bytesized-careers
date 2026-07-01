"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Icon } from "./Icons";
import {
  createReport,
  describeActionError,
  isBackendAuthError,
  saveTalentListing,
  sendTalentInterest,
} from "../lib/backendClient";
import {
  FirstMessageAnswers,
  sanitizeRequirementKeys,
  validateAnswers,
} from "../lib/firstMessageRequirements";
import { formatCompactNumber } from "../lib/format";
import { buildOpeningMessageBody } from "../lib/openingMessage";
import ActionSuccessModal from "./first-message/ActionSuccessModal";
import FirstMessageRequirementsModal from "./first-message/FirstMessageRequirementsModal";
import { IconTooltip, Section, ToolChip } from "./ui";

type ActionState = "idle" | "saving" | "sent" | "error";
type TalentMetadataRow = { label: string; values: string[] };

// Secondary action buttons (Save / Share): clearly pressable — filled surface
// with a subtle lift + shadow — but deliberately subordinate to the solid white
// primary (Hire Me) and visually distinct from the flat, passive stat chips.
const SECONDARY_ACTION_CLASS =
  "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.08] text-sm font-semibold text-white/85 shadow-[0_10px_26px_-20px_rgba(0,0,0,0.95)] transition-all duration-150 hover:-translate-y-[1px] hover:border-white/25 hover:bg-white/[0.13] hover:text-white active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 disabled:cursor-not-allowed disabled:opacity-60";

function TileShell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={[
        "rounded-2xl",
        "bg-white/[0.03] border border-white/[0.06]",
        "px-4 py-3",
        "select-none",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function StatTile({
  icon,
  value,
  label,
}: {
  icon: "eye" | "user-plus" | "bolt";
  value: string;
  label: string;
}) {
  const tooltipId = React.useId();
  const anchorRef = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);

  return (
    <div className="relative">
      <div
        tabIndex={0}
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="cursor-default focus-visible:outline-none"
      >
        <TileShell className="h-[54px] flex items-center justify-center">
          <div ref={anchorRef} className="flex items-center justify-center gap-2 text-white/75 transition-colors duration-150 hover:text-white">
            <Icon name={icon} className="h-4 w-4" />
            <span className="text-sm tabular-nums">{value}</span>
          </div>
        </TileShell>
      </div>
      <span className="sr-only">{label}</span>
      <IconTooltip label={label} anchorRef={anchorRef} open={open} id={tooltipId} sideOffset={4} />
    </div>
  );
}

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
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">
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
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">
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
  talentName,
  views = 0,
  interestedRecruitersCount = 0,
  requirementKeys = [],
  metadataRows = [],
  tools = [],
}: {
  listingId: string;
  /** Display name of the talent being hired, used to personalise the opening message. */
  talentName?: string | null;
  views?: number;
  interestedRecruitersCount?: number;
  requirementKeys?: string[];
  metadataRows?: TalentMetadataRow[];
  tools?: string[];
}) {
  const router = useRouter();
  const { data: session } = useSession();
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
  const [answers, setAnswers] = React.useState<FirstMessageAnswers>({});
  const [answerErrors, setAnswerErrors] = React.useState<Record<string, string>>({});
  const [requirementsOpen, setRequirementsOpen] = React.useState(false);
  const [successOpen, setSuccessOpen] = React.useState(false);
  const [conversationId, setConversationId] = React.useState<string | null>(null);

  const onAnswersChange = (next: FirstMessageAnswers) => {
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
      const errors = validateAnswers(keys, "talent", answers);
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
      // Store a real opening message so the inbox never shows a blank bubble: a
      // required fit note becomes the message, otherwise a natural default is
      // generated (personalised with the talent's name, rotated deterministically
      // per requester + listing so it's varied but stable).
      const fitNote =
        keys.includes("fit_note") && typeof answers.fit_note === "string" ? answers.fit_note : "";
      const note = buildOpeningMessageBody({
        context: "talent",
        recipientName: talentName,
        fitNote,
        seed: `${listingId}:${session?.backendUserId ?? ""}`,
      });
      // The backend reuses an existing active request, so the returned id always
      // points at the one conversation this hiring request created.
      const interest = await sendTalentInterest(
        token,
        listingId,
        note,
        null,
        keys.length ? answers : undefined
      );
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

  const reportListing = async () => {
    if (reportState === "sent" || reportState === "saving") return;
    setReportState("saving");
    try {
      await createReport(
        {
          target_type: "talent_listing",
          target_id: listingId,
          category: "suspicious_or_inaccurate",
          note: null,
        },
        session?.backendAccessToken
      );
      setReportState("sent");
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
          disabled={interestState === "saving" || interestState === "sent"}
          data-testid="talent-hire-button"
          className="inline-flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-white text-lg font-extrabold text-black shadow-[0_18px_40px_-28px_rgba(0,0,0,0.9)] transition-transform duration-150 hover:-translate-y-[1px] hover:bg-white/95 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-65"
        >
          <Icon name="briefcase" className="h-5 w-5" />
          {interestState === "saving" ? "Sending..." : interestState === "sent" ? "Request sent" : "Hire Me"}
        </button>
        {interestState === "error" ? (
          <p className="mt-2 text-xs text-amber-200/80">{interestError || "Couldn’t contact talent. Try again."}</p>
        ) : null}
        {interestState === "sent" ? (
          <p className="mt-2 text-xs text-white/52">
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
        {shareState === "copied" ? <p className="mt-2 text-xs text-white/45">Link copied to your clipboard.</p> : null}

        <div className="mt-4 grid grid-cols-3 gap-3">
          <StatTile icon="eye" value={formatCompactNumber(views)} label="Currently viewing" />
          <StatTile icon="user-plus" value={formatCompactNumber(interestedRecruitersCount)} label="Interested recruiters" />
          <StatTile icon="bolt" value="0%" label="Response rate" />
        </div>
      </section>

      <TalentMetadataCard rows={metadataRows} tools={tools} />

      <div data-testid="talent-safety-card">
        <Section title="Safety & expectations" bodyClassName="mt-3 text-sm leading-relaxed text-white/80">
          Keep communication inside the platform, agree on scope, timeline, revisions, and payment terms before starting.
        </Section>
      </div>

      <div className="-mt-3 px-1">
        <button
          type="button"
          onClick={reportListing}
          disabled={reportState === "saving" || reportState === "sent"}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md text-xs font-semibold text-white/42 underline-offset-4 transition hover:text-white/72 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/18 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0f] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon name="alert" className="h-3.5 w-3.5" />
          {reportState === "saving" ? "Reporting..." : reportState === "sent" ? "Reported" : "Report this listing"}
        </button>
        {reportState === "error" ? (
          <p className="mt-2 text-xs text-white/45">Couldn’t send the report. Try again.</p>
        ) : null}
      </div>

      <FirstMessageRequirementsModal
        open={requirementsOpen}
        context="talent"
        requirementKeys={keys}
        answers={answers}
        onAnswersChange={onAnswersChange}
        errors={answerErrors}
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
            `/applications?view=hiring${conversationId ? `&thread=${encodeURIComponent(conversationId)}` : ""}`
          )
        }
        onSecondary={() => setSuccessOpen(false)}
        onClose={() => setSuccessOpen(false)}
      />
    </div>
  );
}
