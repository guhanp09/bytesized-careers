"use client";

import React from "react";
import type { JobImportDraft, JobImportField } from "../../lib/jobImportReadiness";
import {
  CONSEQUENTIAL_IMPORT_FIELDS,
  formatImportValue,
  importEditorKind,
  importFieldLabel,
  importValueToEditorText,
  IMPORT_CONTROLLED_OPTIONS,
  IMPORT_MISSING_GROUP_LABELS,
  IMPORT_REVIEW_SECTION_LABELS,
  parseImportEditorValue,
} from "../../lib/jobImportReview";
import {
  importAmberTextClass,
  importEvidenceClass,
  importGhostButton,
  importInputBase,
  importPanelClass,
  importPrimaryButton,
  importTextareaBase,
} from "./importPrimitives";

type ReviewAction = (
  field: JobImportField,
  action:
    | { kind: "accept" | "reject" | "reset" }
    | { kind: "edit"; value: ReturnType<typeof parseImportEditorValue> }
    | { kind: "resolve"; index: number }
    | { kind: "replace"; value: ReturnType<typeof parseImportEditorValue> }
) => Promise<void>;

const PROVENANCE_LABELS: Record<JobImportField["provenance_state"], string> = {
  directly_supplied: "Directly supplied",
  extracted_from_source: "Found in source",
  suggested_inference: "Suggested — verify",
  conflicting_source_values: "Conflict — decision required",
  missing: "Missing",
};

const REVIEW_LABELS: Record<JobImportField["review_status"], string> = {
  pending: "Not reviewed",
  confirmed: "Confirmed by you",
  edited: "Edited by you",
  rejected: "Rejected",
};

function ValueEditor({
  field,
  initialValue,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  field: JobImportField;
  initialValue: unknown;
  submitLabel: string;
  onSubmit: (value: ReturnType<typeof parseImportEditorValue>) => Promise<void>;
  onCancel: () => void;
}) {
  const kind = importEditorKind(field);
  const [value, setValue] = React.useState(() => importValueToEditorText(initialValue, kind));
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const inputId = `import-edit-${field.field_path}`;
  if (kind === "unsupported") {
    return (
      <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
        <p className="text-xs leading-relaxed text-white/60">
          This structured value can be accepted or rejected here and edited in the full job
          editor after conversion.
        </p>
        <button type="button" className={`${importGhostButton} mt-3`} onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }
  const submit = async () => {
    setError("");
    try {
      const parsed = parseImportEditorValue(value, kind);
      setSaving(true);
      await onSubmit(parsed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Check this value and try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
      <label htmlFor={inputId} className="text-xs font-semibold text-white/75">
        {importFieldLabel(field.field_path)}
      </label>
      {kind === "select" ? (
        <select
          id={inputId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className={`${importInputBase} mt-2`}
          autoFocus
        >
          <option value="">Select a value</option>
          {IMPORT_CONTROLLED_OPTIONS[field.field_path].map((option) => (
            <option key={option} value={option}>
              {formatImportValue(option)}
            </option>
          ))}
        </select>
      ) : kind === "boolean" ? (
        <select
          id={inputId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className={`${importInputBase} mt-2`}
          autoFocus
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      ) : kind === "list" ? (
        <textarea
          id={inputId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className={`${importTextareaBase} mt-2 min-h-28`}
          placeholder="One item per line"
          autoFocus
        />
      ) : (
        <input
          id={inputId}
          type={kind === "number" ? "number" : "text"}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className={`${importInputBase} mt-2`}
          autoFocus
        />
      )}
      {error ? (
        <p role="alert" className={`${importAmberTextClass} mt-2`}>
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={importPrimaryButton} onClick={submit} disabled={saving}>
          {saving ? "Saving…" : submitLabel}
        </button>
        <button type="button" className={importGhostButton} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ReviewFieldCard({
  field,
  busy,
  onAction,
}: {
  field: JobImportField;
  busy: boolean;
  onAction: ReviewAction;
}) {
  const [editor, setEditor] = React.useState<"edit" | "replace" | null>(null);
  const consequential = CONSEQUENTIAL_IMPORT_FIELDS.has(field.field_path);
  const currentValue =
    field.effective_value ?? field.proposed_value ?? field.conflicting_values[0]?.value;
  const decisionMade = field.review_status !== "pending";
  return (
    <article
      className={`rounded-2xl border p-4 ${
        consequential
          ? "border-amber-200/25 bg-amber-200/[0.04]"
          : "border-white/10 bg-white/[0.035]"
      }`}
      data-testid={`provider-review-field-${field.field_path}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white">
            {importFieldLabel(field.field_path)}
          </h3>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded-full border border-white/10 px-2 py-1 text-white/60">
              {PROVENANCE_LABELS[field.provenance_state]}
            </span>
            <span
              className={`rounded-full border px-2 py-1 ${
                decisionMade
                  ? "border-emerald-300/20 text-emerald-200/80"
                  : "border-white/10 text-white/50"
              }`}
            >
              {REVIEW_LABELS[field.review_status]}
            </span>
            {consequential ? (
              <span className="rounded-full border border-amber-200/25 px-2 py-1 text-amber-100/80">
                Check carefully
              </span>
            ) : null}
          </div>
        </div>
        <span className="text-[11px] text-white/40">
          {formatImportValue(field.missing_requirement)}
        </span>
      </div>

      {field.provenance_state !== "missing" &&
      field.provenance_state !== "conflicting_source_values" ? (
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-white/80">
          {formatImportValue(currentValue)}
        </p>
      ) : null}

      {field.explanation ? (
        <p className="mt-2 text-xs leading-relaxed text-white/55">{field.explanation}</p>
      ) : null}

      {field.evidence.map((item, index) => (
        <blockquote key={`${field.id}-evidence-${index}`} className={importEvidenceClass}>
          “{item.snippet}”
        </blockquote>
      ))}

      {field.validation_errors.length ? (
        <ul className={`${importAmberTextClass} mt-2 list-disc space-y-1 pl-5`} role="alert">
          {field.validation_errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}

      {field.provenance_state === "conflicting_source_values" ? (
        <fieldset className="mt-3 space-y-2">
          <legend className="text-xs font-semibold text-white/70">
            Choose the source value that is correct
          </legend>
          {field.conflicting_values.map((alternative, index) => (
            <div key={`${field.id}-conflict-${index}`} className="rounded-xl border border-white/10 p-3">
              <p className="text-sm text-white/80">{formatImportValue(alternative.value)}</p>
              {alternative.evidence.map((item, evidenceIndex) => (
                <blockquote
                  key={`${field.id}-conflict-${index}-${evidenceIndex}`}
                  className={importEvidenceClass}
                >
                  “{item.snippet}”
                </blockquote>
              ))}
              <button
                type="button"
                className={`${importGhostButton} mt-3`}
                disabled={busy}
                onClick={() => {
                  void onAction(field, { kind: "resolve", index }).catch(() => undefined);
                }}
              >
                Use this value
              </button>
            </div>
          ))}
          <button
            type="button"
            className={importGhostButton}
            onClick={() => setEditor("replace")}
            disabled={busy}
          >
            Enter a different value
          </button>
        </fieldset>
      ) : null}

      {editor ? (
        <ValueEditor
          field={field}
          initialValue={editor === "edit" ? currentValue : null}
          submitLabel={editor === "edit" ? "Save edit" : "Use replacement"}
          onSubmit={async (value) => {
            await onAction(field, { kind: editor, value });
            setEditor(null);
          }}
          onCancel={() => setEditor(null)}
        />
      ) : null}

      {!editor && field.provenance_state !== "conflicting_source_values" ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {field.provenance_state !== "missing" && field.review_status === "pending" ? (
            <button
              type="button"
              className={importPrimaryButton}
              disabled={busy || field.validation_errors.length > 0}
              onClick={() => {
                void onAction(field, { kind: "accept" }).catch(() => undefined);
              }}
            >
              Accept
            </button>
          ) : null}
          {field.review_status !== "rejected" ? (
            <button
              type="button"
              className={importGhostButton}
              disabled={busy}
              onClick={() => setEditor("edit")}
            >
              {field.provenance_state === "missing" ? "Add value" : "Edit"}
            </button>
          ) : null}
          {field.provenance_state !== "missing" && field.review_status === "pending" ? (
            <button
              type="button"
              className={importGhostButton}
              disabled={busy}
              onClick={() => {
                void onAction(field, { kind: "reject" }).catch(() => undefined);
              }}
            >
              Reject
            </button>
          ) : null}
          {decisionMade ? (
            <button
              type="button"
              className={importGhostButton}
              disabled={busy}
              onClick={() => {
                void onAction(field, { kind: "reset" }).catch(() => undefined);
              }}
            >
              Reset decision
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export default function ImportReviewWorkspace({
  draft,
  busyField,
  applying,
  error,
  onAction,
  onApply,
  onSourceSummary,
  onStartOver,
}: {
  draft: JobImportDraft;
  busyField: string | null;
  applying: boolean;
  error: string;
  onAction: ReviewAction;
  onApply: () => Promise<void>;
  onSourceSummary: () => void;
  onStartOver: () => void;
}) {
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  React.useEffect(() => {
    headingRef.current?.focus();
  }, [draft.id]);

  const missing = draft.fields.filter((field) => field.provenance_state === "missing");
  const reviewed = draft.fields.filter((field) => field.review_status !== "pending").length;
  const proposed = draft.fields.filter((field) => field.provenance_state !== "missing");
  const pending = proposed.filter((field) => field.review_status === "pending").length;
  const bySection = Object.entries(IMPORT_REVIEW_SECTION_LABELS)
    .map(([section, label]) => ({
      section,
      label,
      fields: draft.fields.filter(
        (field) =>
          field.provenance_state !== "missing" &&
          // The backend's review_sections contains only attention items, so map
          // field membership from the stable field catalogue on the client.
          sectionForField(field.field_path) === section
      ),
    }))
    .filter((group) => group.fields.length);

  return (
    <div className="space-y-6" data-testid="provider-import-review">
      <section className={importPanelClass}>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
              Private review
            </p>
            <h2 ref={headingRef} tabIndex={-1} className="mt-2 text-xl font-semibold outline-none">
              Check each imported detail
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/60">
              These details are suggestions until you confirm or edit them. Nothing here is
              published, and rejected or unresolved values will not enter the job draft.
            </p>
          </div>
          <div className="text-sm text-white/55" aria-live="polite">
            {reviewed} reviewed · {pending} awaiting a decision
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={importGhostButton} onClick={onSourceSummary}>
            Source summary
          </button>
          <button type="button" className={importGhostButton} onClick={onStartOver}>
            Start over
          </button>
        </div>
      </section>

      {draft.processing_warnings.length ? (
        <section className="rounded-2xl border border-amber-200/20 bg-amber-200/[0.04] p-4">
          <h2 className="text-sm font-semibold text-amber-100">Review notes</h2>
          {draft.processing_warnings.map((warning, index) => (
            <p key={index} className="mt-1 text-xs text-amber-100/70">
              {typeof warning.message === "string" ? warning.message : "Check the imported details carefully."}
            </p>
          ))}
        </section>
      ) : null}

      {bySection.map((group) => (
        <section key={group.section} aria-labelledby={`review-${group.section}`}>
          <h2 id={`review-${group.section}`} className="mb-3 text-base font-semibold text-white/90">
            {group.label}
          </h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {group.fields.map((field) => (
              <ReviewFieldCard
                key={field.id}
                field={field}
                busy={busyField === field.field_path}
                onAction={onAction}
              />
            ))}
          </div>
        </section>
      ))}

      {missing.length ? (
        <section aria-labelledby="review-missing">
          <h2 id="review-missing" className="mb-1 text-base font-semibold text-white/90">
            Missing information
          </h2>
          <p className="mb-4 text-xs text-white/50">
            You can add practical values now or complete them in the full editor before publishing.
          </p>
          <div className="space-y-5">
            {(
              Object.keys(IMPORT_MISSING_GROUP_LABELS) as Array<
                keyof typeof IMPORT_MISSING_GROUP_LABELS
              >
            ).map((requirement) => {
              const fields = missing.filter((field) => field.missing_requirement === requirement);
              if (!fields.length) return null;
              return (
                <div key={requirement}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/45">
                    {IMPORT_MISSING_GROUP_LABELS[requirement]}
                  </h3>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {fields.map((field) => (
                      <ReviewFieldCard
                        key={field.id}
                        field={field}
                        busy={busyField === field.field_path}
                        onAction={onAction}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="sticky bottom-3 rounded-2xl border border-white/12 bg-[#111117]/95 p-4 shadow-2xl backdrop-blur">
        {error ? (
          <p role="alert" className={`${importAmberTextClass} mb-3`}>
            {error}
          </p>
        ) : null}
        {!draft.can_apply_to_native_draft ? (
          <p className="mb-3 text-xs text-white/55">
            Review every proposed value and resolve conflicts before creating the native draft.
          </p>
        ) : (
          <p className="mb-3 text-xs text-emerald-200/75">
            Your reviewed values are ready for a private native job draft.
          </p>
        )}
        <button
          type="button"
          className={importPrimaryButton}
          disabled={!draft.can_apply_to_native_draft || applying}
          onClick={() => void onApply()}
          data-testid="create-native-job-draft"
        >
          {applying ? "Creating job draft…" : "Create job draft"}
        </button>
      </section>
    </div>
  );
}

function sectionForField(fieldPath: string): string {
  const sectionMap: Record<string, string> = {
    title: "basics",
    primary_role_key: "basics",
    role_specialization: "basics",
    platforms: "basics",
    location: "basics",
    work_mode: "basics",
    engagement_type: "basics",
    experience_level: "basics",
    compensation_mode: "compensation",
    budget_amount: "compensation",
    budget_max: "compensation",
    budget_note: "compensation",
    budget_currency: "compensation",
    budget_unit: "compensation",
    budget_unit_custom: "compensation",
  };
  if (sectionMap[fieldPath]) return sectionMap[fieldPath];
  if (
    /^(start_|timezone_|expected_weekly_|turnaround_|duration_|engagement_end|deliverables)/.test(
      fieldPath
    )
  )
    return "work";
  if (
    /^(about_|responsibilities|requirements|reference_|tags|content_|formats_)/.test(fieldPath)
  )
    return "description";
  if (/^(required_|preferred_|other_required|other_preferred)/.test(fieldPath))
    return "skills_tools";
  if (
    /^(revision_|source_|creative_|trial_|unpaid_trial)/.test(fieldPath)
  )
    return "terms";
  if (
    /^(application_|external_apply|deadline|how_to_apply|hiring_process)/.test(fieldPath)
  )
    return "application";
  return "identity";
}
