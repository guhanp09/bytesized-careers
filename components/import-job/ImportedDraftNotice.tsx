"use client";

import React from "react";
import type { RecruiterJobScreen } from "../../lib/jobPostingForm";
import type { JobImportDraftContext, JobImportField } from "../../lib/jobImportReadiness";
import {
  importDraftSummary,
  importFieldLabel,
  importFieldNeedsAttention,
  importFieldsForScreen,
} from "../../lib/importedDraftGuidance";
import { Icon } from "../Icons";

const conciseValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value
      .slice(0, 3)
      .map((item) =>
        typeof item === "string"
          ? item
          : typeof item === "object" && item && "prompt" in item
            ? String(item.prompt)
            : "Imported detail"
      )
      .join(" · ");
  }
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "Imported detail";
};

function FieldInsight({
  field,
  draft,
  onReview,
  onUseSuggestion,
}: {
  field: JobImportField;
  draft: JobImportDraftContext["draft"];
  onReview: () => void;
  onUseSuggestion: (() => void) | null;
}) {
  const attention = importFieldNeedsAttention(field, new Set(), draft);
  const evidence = field.evidence[0]?.snippet;
  const isContextual = field.decision_origin === "contextual_inference";
  const isConflict = field.provenance_state === "conflicting_source_values";
  const isMissing = field.provenance_state === "missing";
  const suggestion = field.effective_value ?? field.proposed_value;
  const status = isConflict
    ? "Conflicting details"
    : isMissing
      ? "Needs your input"
      : field.decision_origin === "suggestion" || field.needs_review
        ? "Suggestion"
        : "Inferred";

  return (
    <li className="rounded-xl border border-white/[0.08] bg-black/15 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white/82">{importFieldLabel(field.field_path)}</p>
          <p className="mt-1 text-xs text-white/48">{status}</p>
        </div>
        {attention ? (
          <div className="flex flex-wrap justify-end gap-1">
            {onUseSuggestion ? (
              <button
                type="button"
                onClick={onUseSuggestion}
                className="min-h-11 rounded-xl bg-white px-3 text-xs font-semibold text-black transition-colors hover:bg-white/90"
              >
                Use suggestion
              </button>
            ) : null}
            <button
              type="button"
              onClick={onReview}
              className="min-h-11 rounded-xl border border-white/10 px-3 text-xs font-semibold text-white/72 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              Review field
            </button>
          </div>
        ) : null}
      </div>
      {!isMissing && suggestion !== null && suggestion !== undefined ? (
        <p className="mt-2 line-clamp-2 text-sm text-white/72">{conciseValue(suggestion)}</p>
      ) : null}
      {isContextual || field.explanation || evidence ? (
        <details className="mt-2 text-xs text-white/52">
          <summary className="cursor-pointer py-1 font-semibold text-white/58 hover:text-white/80">
            Why was this filled?
          </summary>
          <p className="mt-1 leading-5">
            {field.explanation || "CreatorJobs matched this value to the source context."}
          </p>
          {evidence ? (
            <blockquote className="mt-2 border-l border-white/15 pl-3 text-white/45">
              “{evidence}”
            </blockquote>
          ) : null}
        </details>
      ) : null}
    </li>
  );
}

export default function ImportedDraftNotice({
  context,
  currentScreen,
  screenOrder,
  manuallyChanged,
  dismissed,
  onDismiss,
  onJumpToField,
  onUseSuggestion,
  canUseSuggestion,
}: {
  context: JobImportDraftContext;
  currentScreen: RecruiterJobScreen;
  screenOrder: readonly RecruiterJobScreen[];
  manuallyChanged: ReadonlySet<string>;
  dismissed: boolean;
  onDismiss: () => void;
  onJumpToField: (field: JobImportField) => void;
  onUseSuggestion: (field: JobImportField) => void;
  canUseSuggestion: (field: JobImportField) => boolean;
}) {
  const summary = importDraftSummary(context.draft, manuallyChanged);
  const currentFields = importFieldsForScreen(
    context.draft,
    currentScreen,
    manuallyChanged
  );
  const nextAttention = screenOrder
    .flatMap((screen) => importFieldsForScreen(context.draft, screen, manuallyChanged))
    .find((field) => importFieldNeedsAttention(field, manuallyChanged, context.draft));

  return (
    <div className="space-y-3" data-testid="unified-import-guidance">
      {!dismissed ? (
        <section
          className="rounded-2xl border border-white/10 bg-white/[0.055] p-4"
          aria-label="Imported draft summary"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.07] text-white/60">
              <Icon name="file" className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">Draft created from your job post</p>
              <p className="mt-1 text-sm text-white/58">
                {summary.filled} fields filled · {summary.needsReview} need your review
                {summary.optionalMissing
                  ? ` · ${summary.optionalMissing} optional details not found`
                  : ""}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {nextAttention ? (
                  <button
                    type="button"
                    onClick={() => onJumpToField(nextAttention)}
                    className="min-h-11 rounded-xl bg-white px-3 text-xs font-semibold text-black transition-colors hover:bg-white/90"
                  >
                    Review flagged fields
                  </button>
                ) : null}
                {context.source_url ? (
                  <a
                    href={context.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center rounded-xl px-3 text-xs font-semibold text-white/58 transition-colors hover:bg-white/[0.05] hover:text-white"
                  >
                    View source
                  </a>
                ) : (
                  <span className="px-1 text-xs text-white/38">{context.source_label}</span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              className="min-h-11 shrink-0 rounded-xl px-3 text-xs font-semibold text-white/50 transition-colors hover:bg-white/[0.05] hover:text-white"
              aria-label="Dismiss import summary"
            >
              Dismiss
            </button>
          </div>
        </section>
      ) : null}

      {currentFields.length ? (
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/38">
                Import notes for this section
              </p>
              <p className="mt-1 text-sm text-white/58">
                Only inferred, missing, or ambiguous details appear here.
              </p>
            </div>
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/48">
              {currentFields.length}
            </span>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {currentFields.slice(0, 4).map((field) => (
              <FieldInsight
                key={field.id}
                field={field}
                draft={context.draft}
                onReview={() => onJumpToField(field)}
                onUseSuggestion={
                  field.review_status === "pending" &&
                  field.provenance_state !== "missing" &&
                  field.provenance_state !== "conflicting_source_values" &&
                  field.validation_errors.length === 0 &&
                  field.proposed_value !== null &&
                  field.proposed_value !== undefined &&
                  canUseSuggestion(field)
                    ? () => onUseSuggestion(field)
                    : null
                }
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
