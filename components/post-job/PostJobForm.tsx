"use client";

import { AnimatePresence } from "framer-motion";
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatedStep } from "../ui/StepTransition";
import QuestionTooltip from "../ui/QuestionTooltip";
import { ReferenceTimestampNote, ReferenceVideo, StartTimeframe } from "../../lib/types";
import { onlyDigits } from "../../lib/format";
import { INDIA_CITIES } from "../../lib/indiaCities";
import {
  CONTENT_GENRE_SUGGESTIONS,
  CONTENT_NICHE_SUGGESTIONS,
  FORMATS_HIRED_FOR_SUGGESTIONS,
  CREATOR_CONTEXT_MAX_ITEMS,
  normalizeCreatorContextValue,
} from "../../lib/jobCreatorContext";
import { normalizeReferenceTimestampInput } from "../../lib/referenceVideos";
import { Icon } from "../Icons";
import ToolPicker from "../you/ToolPicker";
import RequirementSelector from "../first-message/RequirementSelector";
import { CUSTOM_INSTRUCTION_REQUIREMENT_KEY } from "../../lib/firstMessageRequirements";
import type { BackendCreateJobPayload, BackendRole } from "../../lib/backendClient";
import {
  COMPENSATION_UNITS,
  ENGAGEMENT_TYPES,
  TURNAROUND_BASES,
  TURNAROUND_UNITS,
  CompensationMode,
  CompensationUnit,
  EngagementType,
  TurnaroundBasis,
  TurnaroundUnit,
  compensationUnitLabel,
  engagementLabel,
} from "../../lib/jobContract";
import {
  weightedJobProgress,
  type JobPostingDomainState,
  type RecruiterJobScreen,
} from "../../lib/jobPostingForm";
import {
  ArrangementDomainFields,
  EmployerContextFields,
  SkillsQualificationsFields,
  TrialApplicationFields,
  WorkDeliverablesFields,
} from "./JobDomainFields";

const JOB_TITLE_MAX_LENGTH = 94;
const MAX_REFERENCE_TIMESTAMP_ROWS = 8;
const MAX_REFERENCE_VIDEOS = 3;

type Step = RecruiterJobScreen;

type Turnaround = { value: number; unit: TurnaroundUnit | ""; basis: TurnaroundBasis | "" } | null;
type BudgetIntent = "" | "range" | "flexible" | "contact";
type WorkMode = "" | "Remote" | "Hybrid" | "On-site";
type JobPlatform = "youtube" | "instagram";

const inputBase =
  "w-full h-11 rounded-xl bg-white/6 border border-white/10 px-3 text-sm text-white placeholder:text-subtle outline-none focus:border-white/25 focus:bg-white/7 transition-colors";

const textareaBase =
  "w-full min-h-[110px] rounded-xl bg-white/6 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-subtle outline-none focus:border-white/25 focus:bg-white/7 transition-colors";

const selectBase =
  "w-full h-11 cursor-pointer rounded-xl bg-white/6 border border-white/10 px-3 text-sm text-white outline-none focus:border-white/25 focus:bg-white/7 transition-colors";

const basicsInputBase =
  "w-full h-11 rounded-xl bg-white/[0.06] border border-white/10 px-3 text-sm text-white placeholder:text-subtle outline-none focus:border-white/25 focus:bg-white/[0.075] transition-colors";

const basicsSelectBase =
  "h-11 cursor-pointer rounded-xl bg-white/[0.06] border border-white/10 px-3 text-sm text-white outline-none focus:border-white/25 focus:bg-white/[0.075] transition-colors";

const decimalText = (value: string) => {
  const cleaned = value.replace(/[^\d.]/g, "");
  const [whole, ...fraction] = cleaned.split(".");
  return fraction.length ? `${whole}.${fraction.join("")}` : whole;
};

const normalizeBulletLines = (value: string) => {
  const lines = value
    .split("\n")
    .map((line) => line.replace(/^\s*[-•]\s+/, ""));
  return lines.length ? lines : [""];
};

const joinBulletLines = (lines: string[]) => lines.join("\n");

function BulletListEditor({
  value,
  onChange,
  placeholder,
  ghostLines,
  ariaLabel = "List item",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  ghostLines?: string[];
  ariaLabel?: string;
}) {
  const [lines, setLines] = useState<string[]>(() => normalizeBulletLines(value));
  const refs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  useLayoutEffect(() => {
    const next = normalizeBulletLines(value);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLines(next);
  }, [value]);

  const updateLines = (next: string[]) => {
    setLines(next);
    onChange(joinBulletLines(next));
  };

  const focusLine = (idx: number, pos?: number) => {
    const el = refs.current[idx];
    if (!el) return;
    requestAnimationFrame(() => {
      el.focus();
      const p = typeof pos === "number" ? pos : el.value.length;
      el.selectionStart = p;
      el.selectionEnd = p;
    });
  };

  return (
    <div
      ref={containerRef}
      className={[
        "relative rounded-xl bg-white/6 border border-white/10 px-3 py-2.5 space-y-2",
        ghostLines && lines.every((l) => !l.trim()) ? "min-h-[96px]" : "",
      ].join(" ")}
      onFocusCapture={() => setIsFocused(true)}
      onBlurCapture={(e) => {
        const nextTarget = e.relatedTarget as Node | null;
        if (!nextTarget || !containerRef.current?.contains(nextTarget)) {
          setIsFocused(false);
        }
      }}
    >
      {ghostLines && lines.every((l) => !l.trim()) && !isFocused ? (
        <div className="absolute inset-0 px-3 py-2.5 pointer-events-none">
          <div className="space-y-2">
            {ghostLines.map((text) => (
              <div key={`ghost-${text}`} className="flex items-start gap-3">
                <span className="mt-[6px] h-2.5 w-2.5 rounded-full bg-white/35 flex-shrink-0" />
                <div className="text-sm text-subtle leading-relaxed">{text}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {lines.map((line, idx) => (
        <div key={`bullet-${idx}`} className="flex items-start gap-3">
          <button
            type="button"
            aria-label="Bullet"
            className="mt-[6px] h-2.5 w-2.5 rounded-full bg-white/80 flex-shrink-0"
            onMouseDown={(e) => {
              e.preventDefault();
              focusLine(idx, 0);
            }}
          />
          <textarea
            aria-label={`${ariaLabel} ${idx + 1}`}
            rows={idx === 0 && lines.length === 1 && line === "" ? 4 : 1}
            ref={(el) => {
              refs.current[idx] = el;
            }}
            className={[
              "w-full bg-transparent text-sm text-white outline-none resize-none leading-relaxed",
              idx === 0 && lines.length === 1 && line === "" ? "min-h-[96px]" : "",
            ].join(" ")}
            value={line}
            placeholder={idx === 0 && lines.length === 1 ? placeholder : undefined}
            onChange={(e) => {
              const next = [...lines];
              next[idx] = e.target.value;
              updateLines(next);
            }}
            onKeyDown={(e) => {
              const el = e.currentTarget;
              const start = el.selectionStart || 0;
              const end = el.selectionEnd || 0;

              if (e.key === "Enter") {
                e.preventDefault();
                const next = [...lines];
                next.splice(idx + 1, 0, "");
                updateLines(next);
                setTimeout(() => focusLine(idx + 1, 0), 0);
                return;
              }

              if (e.key === "Backspace" && start === 0 && end === 0) {
                e.preventDefault();
                if (idx === 0) {
                  if (!line) return;
                  const next = [...lines];
                  next[0] = "";
                  updateLines(next);
                  focusLine(0, 0);
                  return;
                }
                const prev = lines[idx - 1];
                const merged = prev ? `${prev}${line ? " " : ""}${line}` : line;
                const next = [...lines];
                next[idx - 1] = merged;
                next.splice(idx, 1);
                updateLines(next);
                focusLine(idx - 1, prev.length);
                return;
              }
            }}
            onFocus={() => {
              if (lines.length === 1 && lines[0] === "") {
                updateLines([""]);
              }
            }}
          />
        </div>
      ))}
    </div>
  );
}

const PLATFORM_SUGGESTIONS = ["YouTube", "Instagram"];


type IconName = React.ComponentProps<typeof Icon>["name"];

/**
 * Experience wordings offered as a starting point, never as the whole domain.
 *
 * ``experience_level`` is a plain string in the schema — no enum, no validator,
 * nothing in search or matching depends on it. These four bands are the common
 * cases, and treating them as the field's only legal values is what produced a
 * listing claiming "5–8 years" from a source that said twenty-five.
 */
const EXPERIENCE_SUGGESTIONS = [
  "0–1 years",
  "1–3 years",
  "3–5 years",
  "5–8 years",
] as const;

/** The longest an experience requirement may be, matching the column. */
const EXPERIENCE_MAX_LENGTH = 64;

function LabelWithIcon({
  icon,
  children,
}: {
  icon: IconName;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-semibold text-white/80">
      <span aria-hidden="true" className="inline-flex text-white/72">
        <Icon name={icon} className="h-4 w-4" />
      </span>
      <span>{children}</span>
    </span>
  );
}

function PlatformMark({ platform }: { platform: "youtube" | "instagram" }) {
  if (platform === "youtube") {
    return (
      <span className="inline-flex h-[18px] w-6 items-center justify-center rounded-[5px] bg-[#ff0033] text-white shadow-[0_6px_18px_-10px_rgba(255,0,51,0.9)]">
        <svg viewBox="0 0 24 24" className="h-3 w-3" aria-hidden="true">
          <path fill="currentColor" d="M9.5 7.8v8.4L16.2 12 9.5 7.8Z" />
        </svg>
      </span>
    );
  }

  return (
    <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-[radial-gradient(circle_at_30%_105%,#feda75_0%,#feda75_22%,#fa7e1e_42%,#d62976_62%,#962fbf_78%,#4f5bd5_100%)] text-white shadow-[0_6px_18px_-10px_rgba(214,41,118,0.9)]">
      <Icon name="instagram" className="h-3 w-3" />
    </span>
  );
}


function Field({
  id,
  label,
  children,
  helper,
  error,
}: {
  id?: string;
  label: React.ReactNode;
  children: React.ReactNode;
  /** Retained for call-site compatibility; optional state is shown by the absent asterisk. */
  optional?: boolean;
  helper?: string;
  error?: string;
}) {
  const labelInner = (
    <>
      {label}
      {helper ? <QuestionTooltip label={helper} /> : null}
    </>
  );
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        {id ? (
          <label htmlFor={id} className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/80">
            {labelInner}
          </label>
        ) : (
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/80">{labelInner}</div>
        )}
        {error ? (
          <div id={id ? `${id}-error` : undefined} role="alert" className="inline-flex items-center gap-1 text-[11px] text-amber-200/90">
            <Icon name="alert" className="w-3 h-3" />
            <span>{error}</span>
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

type EditableTimestampRow = {
  id: string;
  time: string;
  title: string;
  description: string;
  error?: string | null;
};

const makeTimestampRowId = () => `timestamp-row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const timestampNoteToRow = (note: ReferenceTimestampNote): EditableTimestampRow => ({
  id: note.id || makeTimestampRowId(),
  time: note.time,
  title: note.title,
  description: note.description,
  error: null,
});

const blankTimestampRow = (): EditableTimestampRow => ({
  id: makeTimestampRowId(),
  time: "",
  title: "",
  description: "",
  error: null,
});

const timestampRowsFromNotes = (timestampNotes: ReferenceTimestampNote[]) =>
  timestampNotes.length ? timestampNotes.map(timestampNoteToRow) : [blankTimestampRow()];

const sanitizeTimestampDraftInput = (value: string) => value.replace(/[^\d:]/g, "").slice(0, 16);

const timestampRowHasContent = (row: EditableTimestampRow) =>
  Boolean(row.time.trim() || row.title.trim() || row.description.trim());

const rowsToTimestampNotes = (rows: EditableTimestampRow[]): ReferenceTimestampNote[] =>
  rows
    .map((row): ReferenceTimestampNote | null => {
      if (!timestampRowHasContent(row)) return null;
      const normalized = normalizeReferenceTimestampInput(row.time);
      if (!normalized) return null;
      const title = row.title.trim();
      const description = row.description.trim();
      if (!title && !description) return null;
      return {
        id: row.id,
        time: normalized.time,
        seconds: normalized.seconds,
        title: title.slice(0, 60) || "Reference moment",
        description: description.slice(0, 220),
      };
    })
    .filter((entry): entry is ReferenceTimestampNote => Boolean(entry))
    .slice(0, MAX_REFERENCE_TIMESTAMP_ROWS);

function ReferenceNotesEditor({
  whatToReference,
  timestampNotes,
  onWhatToReferenceChange,
  onTimestampNotesChange,
}: {
  whatToReference: string;
  timestampNotes: ReferenceTimestampNote[];
  onWhatToReferenceChange: (next: string) => void;
  onTimestampNotesChange: (next: ReferenceTimestampNote[]) => void;
}) {
  const [rows, setRows] = useState<EditableTimestampRow[]>(() => timestampRowsFromNotes(timestampNotes));
  const emittedSignatureRef = useRef("");
  const focusRowIdRef = useRef<string | null>(null);
  const timeInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const maxNotesReached = rows.length >= MAX_REFERENCE_TIMESTAMP_ROWS;

  React.useEffect(() => {
    const signature = JSON.stringify(timestampNotes);
    if (signature === emittedSignatureRef.current) return;
    setRows(timestampRowsFromNotes(timestampNotes));
  }, [timestampNotes]);

  useLayoutEffect(() => {
    if (!focusRowIdRef.current) return;
    timeInputRefs.current[focusRowIdRef.current]?.focus();
    focusRowIdRef.current = null;
  }, [rows.length]);

  const emitRows = (nextRows: EditableTimestampRow[]) => {
    const cleaned = rowsToTimestampNotes(nextRows);
    const signature = JSON.stringify(cleaned);
    emittedSignatureRef.current = signature;
    onTimestampNotesChange(cleaned);
  };

  const updateRows = (updater: (current: EditableTimestampRow[]) => EditableTimestampRow[]) => {
    setRows((current) => {
      const nextRows = updater(current);
      emitRows(nextRows);
      return nextRows;
    });
  };

  const normalizeRowTime = (row: EditableTimestampRow): EditableTimestampRow => {
    if (!timestampRowHasContent(row)) {
      return { ...row, time: "", error: null };
    }
    const normalized = normalizeReferenceTimestampInput(row.time);
    if (!normalized) {
      return { ...row, error: "Use 0:12, 4:04, or 1:02:03." };
    }
    return { ...row, time: normalized.time, error: null };
  };

  const updateRow = (id: string, patch: Partial<EditableTimestampRow>) => {
    updateRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const handleTimeBlur = (id: string) => {
    updateRows((current) => current.map((row) => (row.id === id ? normalizeRowTime(row) : row)));
  };

  const addRow = () => {
    if (maxNotesReached) return;
    const nextRow = blankTimestampRow();
    focusRowIdRef.current = nextRow.id;
    updateRows((current) => [...current, nextRow]);
  };

  const removeRow = (id: string) => {
    updateRows((current) => {
      const nextRows = current.filter((row) => row.id !== id);
      return nextRows.length ? nextRows : [blankTimestampRow()];
    });
  };

  return (
    <div className="space-y-5">
      <Field
        label={<LabelWithIcon icon="eye">What to reference</LabelWithIcon>}
        helper="Tell candidates what to study from this reference."
      >
        <textarea
          className={`${textareaBase} min-h-[92px]`}
          maxLength={400}
          placeholder="Focus on the pacing, caption rhythm, and how the intro keeps attention."
          value={whatToReference}
          onChange={(event) => onWhatToReferenceChange(event.target.value.slice(0, 400))}
        />
      </Field>

      <div className="space-y-3 border-t border-white/[0.08] pt-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-white/80">
              <LabelWithIcon icon="clock">Timestamp notes</LabelWithIcon>
            </div>
            <div className="mt-1 text-[11px] text-muted">Add moments candidates should jump to.</div>
          </div>
          <div className="text-[11px] text-subtle">{rows.length}/{MAX_REFERENCE_TIMESTAMP_ROWS}</div>
        </div>

        <div className="hidden grid-cols-[112px_minmax(0,0.7fr)_minmax(0,1fr)] gap-3 px-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-subtle sm:grid">
          <span>Time</span>
          <span>Label</span>
          <span>Note</span>
        </div>

        <div className="space-y-2">
          {rows.map((row, idx) => (
            <div
              key={row.id}
              className="grid gap-2 border-b border-white/[0.06] pb-2 last:border-b-0 last:pb-0 sm:grid-cols-[112px_minmax(0,0.7fr)_minmax(0,1fr)_auto]"
            >
              <div className="space-y-1">
                <input
                  ref={(node) => {
                    timeInputRefs.current[row.id] = node;
                  }}
                  className={[
                    inputBase,
                    row.error ? "border-amber-300/35 bg-amber-300/[0.035] focus:border-amber-200/60" : "",
                  ].join(" ")}
                  placeholder="0:00"
                  value={row.time}
                  onChange={(event) => updateRow(row.id, { time: sanitizeTimestampDraftInput(event.target.value), error: null })}
                  onBlur={() => handleTimeBlur(row.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleTimeBlur(row.id);
                    }
                  }}
                  aria-label={`Timestamp ${idx + 1}`}
                  inputMode="numeric"
                />
                {row.error ? <div className="text-[10px] text-amber-200/80">{row.error}</div> : null}
              </div>
              <input
                className={inputBase}
                placeholder="Hook pacing"
                maxLength={60}
                value={row.title}
                onChange={(event) => updateRow(row.id, { title: event.target.value.slice(0, 60) })}
                aria-label={`Timestamp ${idx + 1} label`}
              />
              <input
                className={inputBase}
                placeholder="Cold open hits immediately..."
                maxLength={220}
                value={row.description}
                onChange={(event) => updateRow(row.id, { description: event.target.value.slice(0, 220) })}
                aria-label={`Timestamp ${idx + 1} note`}
              />
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-muted transition-colors hover:bg-white/[0.08] hover:text-white"
                aria-label={`Remove timestamp row ${idx + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={addRow}
            disabled={maxNotesReached}
            className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg px-1 text-sm font-semibold text-muted transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Icon name="plus" className="h-4 w-4" />
            Add timestamp
          </button>
          {maxNotesReached ? <span className="text-[11px] text-subtle">Maximum 8 timestamps</span> : null}
        </div>
      </div>
    </div>
  );
}

function StepCard({
  title,
  icon,
  hint,
  children,
  actions,
  bodyClassName = "mt-4",
  size = "compact",
}: {
  title?: React.ReactNode;
  icon?: IconName;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
  actions: React.ReactNode;
  bodyClassName?: string;
  size?: "tall" | "compact";
}) {
  const sizeClass = size === "tall" ? "min-h-[420px]" : "h-auto";

  return (
    <section
      className={[
        "rounded-2xl bg-white/[0.06] border border-white/10 p-5",
        "shadow-[0_10px_30px_-20px_rgba(0,0,0,0.9)]",
        "flex flex-col",
        sizeClass,
      ].join(" ")}
    >
      {title || hint ? (
        <div className="flex items-baseline justify-between gap-3">
          {typeof title === "string" ? (
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-white/90 uppercase">
              {icon ? (
                <span aria-hidden="true" className="inline-flex shrink-0 text-white/58">
                  <Icon name={icon} className="h-4 w-4" />
                </span>
              ) : null}
              <span>{title}</span>
            </h2>
          ) : (
            title
          )}
          {hint ? (
            <div className="text-xs text-muted">{hint}</div>
          ) : null}
        </div>
      ) : null}
      <div
        className={[
          bodyClassName,
          "flex-1 pb-6",
        ].join(" ")}
      >
        {children}
      </div>
      <div className="pt-2 mt-2 border-t border-white/5">{actions}</div>
    </section>
  );
}


function TinyChip({
  label,
  children,
  onRemove,
}: {
  label: string;
  children: React.ReactNode;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-lg bg-white/8 border border-white/10 px-2 py-1 text-[11px] text-white/80">
      {children}
      <button
        type="button"
        onClick={onRemove}
        className="h-5 w-5 rounded-md hover:bg-white/10 inline-flex items-center justify-center text-white/70"
        aria-label={`Remove ${label}`}
        title={`Remove ${label}`}
      >
        ×
      </button>
    </span>
  );
}

function CreatorContextChipField({
  label,
  helper,
  icon,
  value,
  suggestions,
  targetId,
  onChange,
}: {
  label: string;
  helper: string;
  icon: IconName;
  value: string[];
  suggestions: readonly string[];
  targetId?: string;
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim();
  const selectedKeys = useMemo(() => new Set(value.map((item) => item.toLowerCase())), [value]);
  const visibleSuggestions = suggestions
    .filter((suggestion) => !selectedKeys.has(suggestion.toLowerCase()))
    .filter((suggestion) => !normalizedQuery || suggestion.toLowerCase().includes(normalizedQuery.toLowerCase()))
    .slice(0, 8);

  const addValue = (raw: string) => {
    const nextValue = normalizeCreatorContextValue(raw);
    if (!nextValue) return;
    if (selectedKeys.has(nextValue.toLowerCase())) {
      setQuery("");
      return;
    }
    if (value.length >= CREATOR_CONTEXT_MAX_ITEMS) return;
    onChange([...value, nextValue]);
    setQuery("");
  };

  const removeValue = (item: string) => {
    onChange(value.filter((current) => current !== item));
  };

  return (
    <div className="space-y-2" data-quality-target={targetId}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-white/78">
            <LabelWithIcon icon={icon}>{label}</LabelWithIcon>
          </div>
          <div className="mt-0.5 text-[11px] text-subtle">{helper}</div>
        </div>
        <div className="text-[11px] text-subtle">{value.length}/{CREATOR_CONTEXT_MAX_ITEMS}</div>
      </div>

      {value.length ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((item) => (
            <TinyChip key={item} label={item} onRemove={() => removeValue(item)}>
              {item}
            </TinyChip>
          ))}
        </div>
      ) : null}

      <input
        aria-label={`Add ${label.toLowerCase()}`}
        className="h-9 w-full rounded-xl border border-white/10 bg-white/[0.045] px-3 text-xs text-white outline-none transition-colors placeholder:text-subtle focus:border-white/25 focus:bg-white/[0.065]"
        value={query}
        placeholder={`Add ${label.toLowerCase()}`}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            addValue(query);
          }
        }}
      />

      <div className="flex flex-wrap gap-1.5">
        {visibleSuggestions.map((suggestion) => (
          <button
            type="button"
            key={suggestion}
            className="h-7 cursor-pointer rounded-lg border border-white/[0.09] bg-white/[0.04] px-2 text-[11px] font-medium text-white/58 transition-colors hover:border-white/18 hover:bg-white/[0.075] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/15"
            onClick={() => addValue(suggestion)}
          >
            {suggestion}
          </button>
        ))}
        {normalizedQuery && !selectedKeys.has(normalizedQuery.toLowerCase()) ? (
          <button
            type="button"
            className="h-7 cursor-pointer rounded-lg border border-white/20 bg-white/[0.08] px-2 text-[11px] font-semibold text-white/78 transition-colors hover:bg-white/[0.12] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/15"
            onClick={() => addValue(query)}
          >
            Add “{normalizeCreatorContextValue(query)}”
          </button>
        ) : null}
      </div>
    </div>
  );
}

type StepActionsProps = {
  id: Step;
  saveKey?: "basics" | "content" | "tags" | "refs";
  canSave: boolean;
  onSave?: () => boolean | void;
  canGoBack: boolean;
  canGoNext: boolean;
  onBack: (step: Step) => void;
  onNext: (step: Step) => void;
  nextLabel?: string;
  nextIcon?: React.ReactNode;
  nextAriaLabel?: string;
  nextType?: "button" | "submit";
  nextDisabled?: boolean;
  isBusy?: boolean;
  onSaveDraft?: () => void;
  saveDraftLabel?: string;
  saveDraftIcon?: React.ReactNode;
  savedSection: null | "basics" | "content" | "tags" | "refs";
  onSaveClick: (
    section: "basics" | "content" | "tags" | "refs",
    handler?: () => boolean | void
  ) => void;
  variant?: "embedded" | "mobile-fixed";
};

function StepActions({
  id,
  canGoBack,
  canGoNext,
  onBack,
  onNext,
  nextLabel,
  nextIcon,
  nextAriaLabel,
  nextType = "button",
  nextDisabled = false,
  isBusy = false,
  onSaveDraft,
  saveDraftLabel = "Save draft",
  saveDraftIcon,
  variant = "embedded",
}: StepActionsProps) {
  const nextAccessibleLabel = nextAriaLabel || nextLabel || "Continue";
  const nextContent = nextLabel ? (
    <>
      {nextIcon}
      <span className="text-xs font-semibold">{nextLabel}</span>
    </>
  ) : nextIcon ? (
    nextIcon
  ) : (
    <span className="text-sm leading-none">→</span>
  );
  return (
    <div
      className={
        variant === "mobile-fixed"
          ? "fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-2 border-t border-white/10 bg-[#121216]/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-18px_45px_-30px_rgba(0,0,0,0.95)] backdrop-blur-xl sm:hidden"
          : "mt-4 hidden items-center justify-between gap-2 sm:flex sm:flex-nowrap"
      }
    >
      <div className="flex min-w-0 flex-1 flex-row-reverse items-center justify-end gap-2 sm:flex-row">
        {onSaveDraft ? (
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={isBusy}
            className="inline-flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-white/[0.16] bg-white/[0.065] px-2.5 text-xs font-semibold text-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-[background-color,border-color,color,transform] hover:border-white/25 hover:bg-white/[0.095] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101014] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55 sm:min-w-[116px] sm:flex-none sm:px-4 sm:text-sm"
          >
            {saveDraftIcon}
            {saveDraftLabel}
          </button>
        ) : null}
        {canGoBack ? (
          <button
            type="button"
            onClick={() => onBack(id)}
            className="h-11 w-11 inline-flex cursor-pointer items-center justify-center rounded-xl bg-white text-black border border-white hover:bg-white/90 transition-colors disabled:cursor-not-allowed disabled:opacity-55"
            aria-label="Back"
            title="Back"
            disabled={isBusy}
          >
            <span className="text-sm leading-none">←</span>
          </button>
        ) : null}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {canGoNext ? (
          <button
            type={nextType}
            onClick={nextType === "submit" ? undefined : () => onNext(id)}
            className={[
              "inline-flex items-center justify-center rounded-xl border transition-colors",
              nextDisabled || isBusy
                ? "cursor-not-allowed border-white/10 bg-white/15 text-subtle"
                : "cursor-pointer bg-white text-black border-white hover:bg-white/90",
              nextLabel ? "min-h-11 px-4 gap-2" : "h-11 w-11",
            ].join(" ")}
            aria-label={nextAccessibleLabel}
            title={nextAccessibleLabel}
            disabled={isBusy || nextDisabled}
          >
            {nextContent}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function PostJobForm({
  step,
  direction,
  hasNext,
  hasBack,
  onNext,
  onBack,
  basicsErrors,
  contentErrors,
  title,
  onTitleChange,
  roles,
  rolesLoading = false,
  rolesError,
  onRetryRoles,
  primaryRoleId,
  roleSpecialization,
  onPrimaryRoleIdChange,
  onRoleSpecializationChange,
  workMode,
  onWorkModeChange,
  city,
  onCityChange,
  budgetMin,
  budgetMax,
  budgetUnit,
  budgetCurrency,
  compensationMode,
  budgetNote,
  budgetUnitCustom,
  onBudgetMinChange,
  onBudgetMaxChange,
  onBudgetUnitChange,
  onBudgetCurrencyChange,
  onCompensationModeChange,
  onBudgetNoteChange,
  onBudgetUnitCustomChange,
  onBudgetIntentChange,
  experienceLevel,
  onExperienceLevelChange,
  startWithin,
  platforms,
  onPlatformToggle,
  contentNiches,
  onContentNichesChange,
  contentGenres,
  onContentGenresChange,
  formatsHiredFor,
  onFormatsHiredForChange,
  turnaround,
  onTurnaroundChange,
  engagementType,
  onEngagementTypeChange,
  expectedWeeklyHoursMin,
  expectedWeeklyHoursMax,
  onExpectedWeeklyHoursMinChange,
  onExpectedWeeklyHoursMaxChange,
  tools,
  onToolsChange,
  languages,
  about,
  responsibilities,
  requirements,
  howToApply,
  onAboutChange,
  onResponsibilitiesChange,
  onRequirementsChange,
  onHowToApplyChange,
  applicationRequirements,
  onApplicationRequirementsChange,
  noFirstMessageRequirements,
  onNoFirstMessageRequirementsChange,
  firstMessageError,
  tagInput,
  tags,
  onTagInputChange,
  onAddTag,
  onRemoveTag,
  refTitle,
  refUrl,
  refWhatToReference,
  refTimestampNotes,
  refUrlError,
  refVideos,
  onRefTitleChange,
  onRefUrlChange,
  onRefWhatToReferenceChange,
  onRefTimestampNotesChange,
  onAddRefVideo,
  onRemoveRefVideo,
  onUpdateRefVideo,
  onSubmit,
  onSaveBasics,
  onSaveContent,
  onSaveDetails,
  onSaveCreatorContext,
  onSaveAbout,
  onSaveApplicationRequirements,
  onSaveReferenceVideos,
  onSaveDraft,
  saveDraftLabel = "Save draft",
  publishLabel = "Publish job",
  canSaveBasics,
  canSaveContent,
  canSaveDetails,
  canSaveCreatorContext,
  canSaveAbout,
  canSaveApplicationRequirements,
  canSaveReferenceVideos,
  submitError,
  isSubmitting,
  publishDisabled = false,
  isRepresentedHiringIdentity = false,
  domain,
  onDomainChange,
  domainErrors,
  listingSchemaVersion,
  selectedRoleName,
  legacyToolsNotCaptured = false,
  legacyBudgetUnit,
  reviewPreview,
  guidedMode = false,
}: {
  step: Step;
  direction: "forward" | "back";
  currentStepNumber: number;
  totalSteps: number;
  hasNext: boolean;
  hasBack: boolean;
  onNext: (step: Step) => void;
  onBack: (step: Step) => void;
  basicsErrors?: Partial<
    Record<"title" | "role" | "city" | "cityInvalid" | "budgetMissing" | "budgetRange" | "identity" | "platform" | "workMode", string>
  >;
  contentErrors?: Partial<Record<"about", string>>;
  title: string;
  onTitleChange: (next: string) => void;
  roles: BackendRole[];
  rolesLoading?: boolean;
  rolesError?: string | null;
  onRetryRoles?: () => void;
  primaryRoleId: string;
  roleSpecialization: string;
  onPrimaryRoleIdChange: (next: string) => void;
  onRoleSpecializationChange: (next: string) => void;
  workMode: WorkMode;
  onWorkModeChange: (next: WorkMode) => void;
  city: string;
  onCityChange: (next: string) => void;
  budgetMin: string;
  budgetMax: string;
  budgetUnit: CompensationUnit | "";
  budgetCurrency: string;
  compensationMode: CompensationMode | "";
  budgetNote: string;
  budgetUnitCustom: string;
  budgetIntent: BudgetIntent;
  onBudgetMinChange: (next: string) => void;
  onBudgetMaxChange: (next: string) => void;
  onBudgetUnitChange: (next: CompensationUnit | "") => void;
  onBudgetCurrencyChange: (next: string) => void;
  onCompensationModeChange: (next: CompensationMode | "") => void;
  onBudgetNoteChange: (next: string) => void;
  onBudgetUnitCustomChange: (next: string) => void;
  onBudgetIntentChange: (next: BudgetIntent) => void;
  experienceLevel: string;
  onExperienceLevelChange: (next: string) => void;
  startWithin: StartTimeframe | "";
  onStartWithinChange: (next: StartTimeframe | "") => void;
  platforms: JobPlatform[];
  onPlatformToggle: (platform: JobPlatform) => void;
  contentNiches: string[];
  onContentNichesChange: (next: string[]) => void;
  contentGenres: string[];
  onContentGenresChange: (next: string[]) => void;
  formatsHiredFor: string[];
  onFormatsHiredForChange: (next: string[]) => void;
  turnaround: Turnaround;
  onTurnaroundChange: (next: Turnaround) => void;
  engagementType: EngagementType | "";
  onEngagementTypeChange: (next: EngagementType | "") => void;
  expectedWeeklyHoursMin: string;
  expectedWeeklyHoursMax: string;
  onExpectedWeeklyHoursMinChange: (next: string) => void;
  onExpectedWeeklyHoursMaxChange: (next: string) => void;
  tools: string[];
  onToolsChange: (next: string[]) => void;
  languages: string[];
  onLanguagesChange: (next: string[]) => void;
  about: string;
  responsibilities: string;
  requirements: string;
  howToApply: string;
  onAboutChange: (next: string) => void;
  onResponsibilitiesChange: (next: string) => void;
  onRequirementsChange: (next: string) => void;
  onHowToApplyChange: (next: string) => void;
  applicationRequirements: string[];
  onApplicationRequirementsChange: (next: string[]) => void;
  noFirstMessageRequirements: boolean;
  onNoFirstMessageRequirementsChange: (next: boolean) => void;
  firstMessageError?: string;
  tagInput: string;
  tags: string[];
  onTagInputChange: (next: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
  refTitle: string;
  refUrl: string;
  refWhatToReference: string;
  refTimestampNotes: ReferenceTimestampNote[];
  refUrlError?: string;
  refVideos: ReferenceVideo[];
  onRefTitleChange: (next: string) => void;
  onRefUrlChange: (next: string) => void;
  onRefWhatToReferenceChange: (next: string) => void;
  onRefTimestampNotesChange: (next: ReferenceTimestampNote[]) => void;
  onAddRefVideo: () => void;
  onRemoveRefVideo: (idx: number) => void;
  onUpdateRefVideo: (idx: number, next: ReferenceVideo) => void;
  onSubmit: (e: React.FormEvent) => void;
  onSaveBasics: () => boolean | void;
  onSaveContent?: () => boolean | void;
  onSaveDetails?: () => boolean | void;
  onSaveCreatorContext?: () => boolean | void;
  onSaveAbout?: () => boolean | void;
  onSaveApplicationRequirements?: () => boolean | void;
  onSaveReferenceVideos?: () => boolean | void;
  onSaveDraft?: () => void;
  saveDraftLabel?: string;
  publishLabel?: string;
  canSaveBasics: boolean;
  canSaveContent: boolean;
  canSaveDetails?: boolean;
  canSaveCreatorContext?: boolean;
  canSaveAbout?: boolean;
  canSaveApplicationRequirements?: boolean;
  canSaveReferenceVideos?: boolean;
  submitError?: string | null;
  isSubmitting?: boolean;
  publishDisabled?: boolean;
  isRepresentedHiringIdentity?: boolean;
  domain: JobPostingDomainState;
  onDomainChange: (
    patch: Partial<JobPostingDomainState>,
    payloadKeys?: Array<keyof BackendCreateJobPayload>
  ) => void;
  domainErrors?: Record<string, string>;
  listingSchemaVersion?: number | null;
  selectedRoleName?: string | null;
  legacyToolsNotCaptured?: boolean;
  legacyBudgetUnit?: string | null;
  reviewPreview?: React.ReactNode;
  guidedMode?: boolean;
}) {
  const [savedSection, setSavedSection] = useState<null | "basics" | "content" | "tags" | "refs">(null);
  const toastTimerRef = useRef<number | null>(null);
  const referenceVideoTitleRef = useRef<HTMLInputElement | null>(null);
  const previousReferenceVideoCountRef = useRef(refVideos.length);
  // Continuous, weighted progress — front-loaded so early steps feel brisk. The
  // raw step count is never exposed (see weightedJobProgress for the model).
  const progressPercent = Math.round(weightedJobProgress(step) * 100);
  const [cityOpen, setCityOpen] = useState(false);
  const [cityHighlight, setCityHighlight] = useState(0);
  const [experienceOpen, setExperienceOpen] = useState(false);
  const [experienceHighlight, setExperienceHighlight] = useState(0);

  const normalizeCity = (value: string) => value.trim().toLowerCase();
  const cityMatch = useMemo(
    () => INDIA_CITIES.find((c) => normalizeCity(c) === normalizeCity(city)),
    [city]
  );

  const citySuggestions = useMemo(() => {
    if (!cityOpen) return [];
    const query = normalizeCity(city);
    if (!query) return INDIA_CITIES.slice(0, 8);
    const starts = INDIA_CITIES.filter((c) => normalizeCity(c).startsWith(query));
    const contains = INDIA_CITIES.filter(
      (c) => !starts.includes(c) && normalizeCity(c).includes(query)
    );
    return [...starts, ...contains].slice(0, 8);
  }, [city, cityOpen]);

  useLayoutEffect(() => {
    if (workMode === "Remote") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCityOpen(false);
    }
  }, [workMode]);

  useLayoutEffect(() => {
    if (refVideos.length > previousReferenceVideoCountRef.current && refVideos.length < MAX_REFERENCE_VIDEOS) {
      referenceVideoTitleRef.current?.focus();
    }
    previousReferenceVideoCountRef.current = refVideos.length;
  }, [refVideos.length]);

  const triggerSavedToast = (section: "basics" | "content" | "tags" | "refs") => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setSavedSection(section);
    toastTimerRef.current = window.setTimeout(() => setSavedSection(null), 2200);
  };

  const handleSave = (
    section: "basics" | "content" | "tags" | "refs",
    handler?: () => boolean | void
  ) => {
    const result = handler ? handler() : true;
    if (result === false) return;
    triggerSavedToast(section);
  };

  const renderScreen = (id: Step) => {
    const titleError = basicsErrors?.title;
    const roleError = basicsErrors?.role;
    const cityError = basicsErrors?.city || basicsErrors?.cityInvalid;
    const budgetError = basicsErrors?.budgetMissing || basicsErrors?.budgetRange;
    const platformError = basicsErrors?.platform;
    const workModeError = basicsErrors?.workMode;
    const invalidClass =
      "border-amber-200/40 ring-1 ring-amber-200/25 focus:border-amber-200/50";
    const selectedRole = roles.find((role) => role.id === primaryRoleId);
    const requiresRoleSpecialization = Boolean(
      primaryRoleId &&
        (selectedRole?.slug === "other-creator-role" ||
          selectedRole?.name === "Other Creator Role" ||
          (!selectedRole && selectedRoleName === "Other Creator Role"))
    );
    const showTurnaround =
      Boolean(turnaround) ||
      engagementType === "one_time_project" ||
      engagementType === "ongoing_freelance" ||
      engagementType === "retainer";
    const engagementError = domainErrors?.engagement_type;
    const weeklyHoursError =
      domainErrors?.expected_weekly_hours_min || domainErrors?.expected_weekly_hours_max;
    const turnaroundError =
      domainErrors?.turnaround_value || domainErrors?.turnaround_unit || domainErrors?.turnaround_basis;

    const basicsMessages = Object.entries(basicsErrors || {}).filter(([key, message]) => key !== "identity" && message);
    const basicsMessageBlock = (keys: string[]) => {
      const items = basicsMessages.filter(([key]) => keys.includes(key));
      if (!items.length) return null;
      return (
        <div className="mt-3 space-y-2">
          {items.map(([, message]) => (
            <div
              key={message}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-amber-200/90"
            >
              <Icon name="alert" className="w-3.5 h-3.5" />
              <span>{message}</span>
            </div>
          ))}
        </div>
      );
    };
    const actionsFor = (
      screenId: Step,
      saveKey: "basics" | "content" | "tags" | "refs",
      canSave: boolean,
      onSave?: () => boolean | void
    ) => (
      <StepActions
        id={screenId}
        saveKey={saveKey}
        canSave={Boolean(canSave)}
        onSave={onSave}
        canGoBack={hasBack}
        canGoNext={hasNext}
        onBack={onBack}
        onNext={onNext}
        isBusy={isSubmitting}
        savedSection={savedSection}
        onSaveClick={handleSave}
        onSaveDraft={onSaveDraft}
        saveDraftLabel={saveDraftLabel}
        saveDraftIcon={<Icon name="file" className="h-4 w-4" />}
      />
    );
    const aboutError = contentErrors?.about;
    const aboutPlaceholder = isRepresentedHiringIdentity
      ? "Share the content creator’s vision, audience, and why this role matters."
      : "Share your brand’s voice, audience, and why this role matters.";
    const customInstructionError =
      applicationRequirements.includes(CUSTOM_INSTRUCTION_REQUIREMENT_KEY) && !howToApply.trim()
        ? firstMessageError
        : undefined;
    const trialApplicationProps = {
      state: domain,
      onChange: onDomainChange,
      errors: domainErrors,
      engagementType,
      compensationCurrency: budgetCurrency,
      compensationUnit: budgetUnit,
      legacyApplicationRequirements: applicationRequirements,
      publicInstructionsLockedReason: applicationRequirements.includes(CUSTOM_INSTRUCTION_REQUIREMENT_KEY)
        ? "Remove the previously saved prompt below before adding separate public instructions."
        : null,
    } as const;

    const tagsFields = (
      <div className="flex flex-col gap-3 rounded-2xl" data-quality-target="job-tags">
        <div className="text-xs font-semibold text-white/80">
          <LabelWithIcon icon="tag">Tags</LabelWithIcon>
        </div>
        <div className="flex gap-2">
          <input
            aria-label="Add a job tag"
            className={inputBase}
            placeholder="Type a tag and press Enter (e.g. Premiere, After Effects)"
            value={tagInput}
            onChange={(e) => onTagInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onAddTag();
              }
            }}
          />
          <button
            type="button"
            className={[
              "h-11 px-4 rounded-xl",
              "bg-white text-black font-semibold text-sm",
              "shadow-[0_14px_35px_-26px_rgba(0,0,0,0.95)]",
              "transition-transform duration-150 hover:-translate-y-[1px] hover:bg-white/95",
            ].join(" ")}
            onClick={onAddTag}
          >
            Add
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {tags.length ? (
            tags.map((t) => (
              <TinyChip key={t} label={t} onRemove={() => onRemoveTag(t)}>
                {t}
              </TinyChip>
            ))
          ) : null}
        </div>
        <div className="text-xs text-muted">
          Use keywords uniquely associated with this role to improve search and discovery.
        </div>
      </div>
    );

    const canCreateMoreReferenceVideos = refVideos.length < MAX_REFERENCE_VIDEOS;
    const nextReferenceVideoNumber = Math.min(refVideos.length + 1, MAX_REFERENCE_VIDEOS);
    const referenceVideoFields = (
      <div className="flex flex-col gap-4" data-quality-target="job-reference-video">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.07] text-white/78">
            <Icon name="video" className="h-5 w-5" />
          </span>
          <h2 className="text-xl font-extrabold tracking-tight text-white">Reference videos</h2>
        </div>

        {refVideos.length ? (
          <div className="space-y-3">
            {refVideos.map((v, idx) => (
              <div key={`${v.url}-${idx}`} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
                <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-subtle">
                      Video {idx + 1}
                    </div>
                    <div className="mt-1 truncate text-sm font-semibold text-white/85">
                      {v.title || `Reference video ${idx + 1}`}
                    </div>
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-2">
                    <a
                      href={v.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/12 bg-white/7 px-3 text-sm font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <Icon name="youtube" className="h-4 w-4" />
                      Open
                    </a>

                    <button
                      type="button"
                      onClick={() => onRemoveRefVideo(idx)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/6 text-white/70 transition-colors hover:bg-white/10"
                      aria-label="Remove"
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className="p-4">
                  <ReferenceNotesEditor
                    whatToReference={v.whatToReference || ""}
                    timestampNotes={v.timestampNotes || []}
                    onWhatToReferenceChange={(next) =>
                      onUpdateRefVideo(idx, { ...v, whatToReference: next.trim() ? next : undefined })
                    }
                    onTimestampNotesChange={(next) => onUpdateRefVideo(idx, { ...v, timestampNotes: next })}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {canCreateMoreReferenceVideos ? (
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
            <div className="border-b border-white/[0.08] px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-subtle">
                Video {nextReferenceVideoNumber}
              </div>
            </div>

            <div className="space-y-5 p-4 sm:p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={<LabelWithIcon icon="file">Video title</LabelWithIcon>}>
                  <input
                    ref={referenceVideoTitleRef}
                    className={inputBase}
                    placeholder="e.g. Pacing + retention reference"
                    value={refTitle}
                    onChange={(e) => onRefTitleChange(e.target.value)}
                  />
                </Field>

                <Field label={<LabelWithIcon icon="external-link">YouTube video URL</LabelWithIcon>} error={refUrlError}>
                  <input
                    className={inputBase}
                    aria-label="YouTube video URL"
                    type="url"
                    placeholder="https://www.youtube.com/watch?v=..."
                    value={refUrl}
                    onChange={(e) => onRefUrlChange(e.target.value)}
                  />
                </Field>
              </div>

              <div className="border-t border-white/[0.08] pt-5">
                <ReferenceNotesEditor
                  whatToReference={refWhatToReference}
                  timestampNotes={refTimestampNotes}
                  onWhatToReferenceChange={onRefWhatToReferenceChange}
                  onTimestampNotesChange={onRefTimestampNotesChange}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-muted">
            Maximum 3 reference videos
          </div>
        )}

        <button
          type="button"
          className={[
            "inline-flex h-16 w-full items-center justify-center gap-2 rounded-2xl",
            "border border-dashed border-white/12 bg-white/[0.025]",
            "cursor-pointer text-sm font-semibold text-subtle transition-colors",
            "hover:border-white/20 hover:bg-white/[0.045] hover:text-white/72",
            "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/12 disabled:hover:bg-white/[0.025] disabled:hover:text-subtle",
          ].join(" ")}
          onClick={onAddRefVideo}
          disabled={!canCreateMoreReferenceVideos}
        >
          <Icon name="plus" className="h-4 w-4" />
          Add another video
        </button>
      </div>
    );

    if (id === "role") {
      return (
        <StepCard
          title="THE ROLE"
          icon="briefcase"
          bodyClassName="mt-8"
          size="compact"
          actions={actionsFor("role", "basics", Boolean(canSaveBasics), onSaveBasics)}
        >
          <div className="flex flex-col gap-6">
            <Field
              id="job-title"
              label={
                <LabelWithIcon icon="briefcase">
                  Job title <span className="text-muted">*</span>
                </LabelWithIcon>
              }
              error={titleError}
            >
              <div className="relative">
                <input
                  id="job-title"
                  aria-label="Job title"
                  aria-required="true"
                  aria-invalid={Boolean(titleError)}
                  aria-describedby={titleError ? "job-title-error" : undefined}
                  className={[basicsInputBase, "pr-16", titleError ? invalidClass : ""].join(" ")}
                  placeholder="e.g. Video editor for YouTube (retention-focused)"
                  value={title}
                  maxLength={JOB_TITLE_MAX_LENGTH}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next.length <= JOB_TITLE_MAX_LENGTH) onTitleChange(next);
                  }}
                />
                <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs tabular-nums text-muted">
                  {title.length}/{JOB_TITLE_MAX_LENGTH}
                </div>
              </div>
            </Field>

            <Field
              id="job-primary-role"
              label={
                <LabelWithIcon icon="users">
                  Creator role <span className="text-muted">*</span>
                </LabelWithIcon>
              }
              helper="Choose the closest creator-economy role. Older category values remain preserved for compatibility."
              error={requiresRoleSpecialization ? undefined : roleError}
            >
              <select
                id="job-primary-role"
                aria-label="Creator role"
                className={[basicsSelectBase, "w-full"].join(" ")}
                aria-invalid={Boolean(roleError && !requiresRoleSpecialization)}
                aria-describedby={roleError && !requiresRoleSpecialization ? "job-primary-role-error" : undefined}
                value={primaryRoleId}
                disabled={rolesLoading}
                onChange={(event) => onPrimaryRoleIdChange(event.target.value)}
                data-quality-target="job-primary-role"
              >
                <option value="" className="bg-[#0b0b0f]">{rolesLoading ? "Loading creator roles…" : "Select a creator role"}</option>
                {primaryRoleId && selectedRoleName && !roles.some((role) => role.id === primaryRoleId) ? (
                  <option value={primaryRoleId} className="bg-[#0b0b0f]">
                    {selectedRoleName} (previous role)
                  </option>
                ) : null}
                {roles.map((role) => (
                  <option key={role.id} value={role.id} className="bg-[#0b0b0f]">
                    {role.name}
                  </option>
                ))}
              </select>
            </Field>

            {requiresRoleSpecialization ? (
              <Field id="job-role-specialization" label="Role specialization" helper="Describe the role in a short, candidate-facing phrase." error={roleError}>
                <input
                  id="job-role-specialization"
                  aria-label="Role specialization"
                  aria-required="true"
                  aria-invalid={Boolean(roleError)}
                  aria-describedby={roleError ? "job-role-specialization-error" : undefined}
                  className={basicsInputBase}
                  value={roleSpecialization}
                  maxLength={120}
                  placeholder="e.g. Creator partnerships coordinator"
                  onChange={(event) => onRoleSpecializationChange(event.target.value)}
                />
              </Field>
            ) : null}

            {rolesError ? (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200/20 bg-amber-200/[0.07] px-3 py-2.5 text-xs text-amber-100/85">
                <span>{rolesError} You can keep this draft, then retry before publishing.</span>
                {onRetryRoles ? (
                  <button type="button" onClick={onRetryRoles} className="min-h-9 rounded-lg border border-amber-100/25 px-3 font-semibold text-amber-50 hover:bg-amber-100/10">
                    Retry
                  </button>
                ) : null}
              </div>
            ) : null}

            <EmployerContextFields
              state={domain}
              onChange={onDomainChange}
              errors={domainErrors}
              recruiterIdentityKind={isRepresentedHiringIdentity ? "Represented creator" : "Direct hiring"}
            />

            <Field
              label={
                <LabelWithIcon icon="screen">
                  Platform <span className="text-muted">*</span>
                </LabelWithIcon>
              }
              error={platformError}
            >
              <div className="flex flex-wrap gap-2" role="group" aria-label="Platforms">
                {PLATFORM_SUGGESTIONS.map((p) => {
                  const key = p.toLowerCase() as "youtube" | "instagram";
                  const active = platforms.includes(key);
                  return (
                    <button
                      key={p}
                      type="button"
                      className={[
                        "inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border px-3.5 text-sm font-semibold shadow-[0_12px_28px_-22px_rgba(0,0,0,0.95)] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101014]",
                        active
                          ? "border-white bg-white text-black"
                          : "border-white/12 bg-white/[0.06] text-white/82 hover:border-white/22 hover:bg-white/[0.09] hover:text-white",
                      ].join(" ")}
                      aria-pressed={active}
                      onClick={() => onPlatformToggle(key)}
                    >
                      <PlatformMark platform={key} />
                      {p}
                    </button>
                  );
                })}
              </div>
            </Field>

            {basicsMessageBlock(["title", "role", "platform"])}
          </div>
        </StepCard>
      );
    }

    if (id === "pay") {
      return (
        <StepCard
          title="PAY"
          icon="wallet"
          bodyClassName="mt-8"
          size="compact"
          actions={actionsFor("pay", "basics", Boolean(canSaveBasics), onSaveBasics)}
        >
          <div className="flex flex-col gap-6">
            <Field
              id="job-compensation-mode"
              label={
                <LabelWithIcon icon="wallet">
                  Compensation <span className="text-muted">*</span>
                </LabelWithIcon>
              }
              error={budgetError}
            >
              {legacyBudgetUnit ? (
                <div className="mb-3 rounded-xl border border-amber-200/20 bg-amber-200/[0.07] px-3 py-2.5 text-xs leading-5 text-amber-100/82">
                  Previously saved compensation unit: <span className="font-semibold">{legacyBudgetUnit}</span>. It remains unchanged until you choose a supported unit below.
                </div>
              ) : null}
              <div className="mb-3 grid gap-3 sm:grid-cols-2">
                <select
                  id="job-compensation-mode"
                  aria-label="Compensation mode"
                  aria-invalid={Boolean(budgetError)}
                  aria-describedby={budgetError ? "job-compensation-mode-error" : undefined}
                  className={[basicsSelectBase, "min-w-0 w-full"].join(" ")}
                  value={compensationMode}
                  onChange={(event) => onCompensationModeChange(event.target.value as CompensationMode | "")}
                >
                  <option value="" className="bg-[#0b0b0f]">Choose compensation mode</option>
                  <option value="fixed" className="bg-[#0b0b0f]">Fixed amount</option>
                  <option value="range" className="bg-[#0b0b0f]">Range</option>
                  <option value="negotiable" className="bg-[#0b0b0f]">Negotiable</option>
                </select>
                <select
                  aria-label="Compensation currency"
                  className={[basicsSelectBase, "min-w-0 w-full"].join(" ")}
                  value={budgetCurrency}
                  onChange={(event) => onBudgetCurrencyChange(event.target.value)}
                >
                  <option value="" className="bg-[#0b0b0f]">Choose currency</option>
                  {(["INR", "USD", "EUR", "GBP", "CAD", "AUD"] as const).map((currency) => (
                    <option key={currency} value={currency} className="bg-[#0b0b0f]">{currency}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2.5 lg:flex-nowrap">
                {compensationMode !== "negotiable" ? (
                <div className="relative min-w-[132px] flex-[1_1_160px]">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-white/72">
                    {budgetCurrency || "¤"}
                  </span>
                  <input
                    aria-required="true"
                    aria-invalid={Boolean(budgetError)}
                    aria-describedby={budgetError ? "job-compensation-mode-error" : undefined}
                    className={[basicsInputBase, "pl-9", budgetError ? invalidClass : ""].join(" ")}
                    placeholder="Min"
                    aria-label={compensationMode === "range" ? "Minimum compensation" : "Compensation amount"}
                    inputMode="numeric"
                    value={budgetMin}
                    onChange={(e) => {
                      onBudgetIntentChange("range");
                      if (!compensationMode) onCompensationModeChange("fixed");
                      onBudgetMinChange(decimalText(e.target.value));
                    }}
                  />
                </div>
                ) : null}

                {compensationMode === "range" ? (
                  <span className="hidden text-base text-muted select-none sm:inline-flex">–</span>
                ) : null}

                {compensationMode === "range" ? (
                <div className="relative min-w-[132px] flex-[1_1_160px]">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-white/72">
                    {budgetCurrency || "¤"}
                  </span>
                  <input
                    aria-required="true"
                    aria-invalid={Boolean(budgetError)}
                    aria-describedby={budgetError ? "job-compensation-mode-error" : undefined}
                    className={[basicsInputBase, "pl-9", budgetError ? invalidClass : ""].join(" ")}
                    placeholder="Max"
                    aria-label="Maximum compensation"
                    inputMode="numeric"
                    value={budgetMax}
                    onChange={(e) => {
                      onBudgetIntentChange("range");
                      onCompensationModeChange("range");
                      onBudgetMaxChange(decimalText(e.target.value));
                    }}
                  />
                </div>
                ) : null}

                <div className="relative min-w-[132px] flex-[0_1_150px]">
                  <select
                    className={[basicsSelectBase, "w-full appearance-none pr-10"].join(" ")}
                    value={legacyBudgetUnit ? "" : budgetUnit}
                    aria-label="Compensation unit"
                    onChange={(e) => onBudgetUnitChange(e.target.value as CompensationUnit | "")}
                  >
                    <option value="" className="bg-[#0b0b0f]">
                      {legacyBudgetUnit ? "Choose a supported unit" : "Choose unit"}
                    </option>
                    {COMPENSATION_UNITS.map((u) => (
                      <option key={u} value={u} className="bg-[#0b0b0f]">
                        {compensationUnitLabel(u)}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-lg leading-none text-white/70">
                    ⌄
                  </span>
                </div>
              </div>
              {budgetUnit === "custom" ? (
                <input
                  className={[basicsInputBase, "mt-3"].join(" ")}
                  value={budgetUnitCustom}
                  maxLength={64}
                  placeholder="Describe the custom unit"
                  onChange={(event) => onBudgetUnitCustomChange(event.target.value)}
                />
              ) : null}
              {compensationMode || budgetUnit === "commission" || budgetUnit === "mixed" || budgetUnit === "custom" ? (
                <textarea
                  className={[textareaBase, "mt-3 min-h-[76px]"].join(" ")}
                  value={budgetNote}
                  maxLength={255}
                  aria-label="Compensation note"
                  placeholder={budgetUnit === "commission" || budgetUnit === "mixed" ? "Explain the base, incentive, or commission terms" : "Optional context candidates should know about the rate"}
                  onChange={(event) => onBudgetNoteChange(event.target.value)}
                />
              ) : null}
            </Field>

            <Field
              id="job-experience"
              label={<LabelWithIcon icon="cap">Experience</LabelWithIcon>}
              optional
              helper="Pick a suggestion or write your own — for example 10+ years, or Experience preferred."
            >
              <div className="relative" data-quality-target="job-experience">
                <input
                  id="job-experience"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={experienceOpen}
                  aria-controls="job-experience-options"
                  aria-label="Experience"
                  aria-activedescendant={
                    experienceOpen && EXPERIENCE_SUGGESTIONS[experienceHighlight]
                      ? `job-experience-option-${experienceHighlight}`
                      : undefined
                  }
                  className={basicsInputBase}
                  placeholder="e.g. 3–5 years"
                  maxLength={EXPERIENCE_MAX_LENGTH}
                  value={experienceLevel}
                  onChange={(event) => {
                    onExperienceLevelChange(event.target.value);
                    if (!experienceOpen) setExperienceOpen(true);
                    setExperienceHighlight(0);
                  }}
                  onFocus={() => {
                    setExperienceOpen(true);
                    setExperienceHighlight(0);
                  }}
                  // Deliberately unlike the city field above, which snaps to its
                  // closest match on blur. Doing that here would silently turn a
                  // recruiter's "25 years" into a suggested band, which is the
                  // exact substitution this control exists to stop.
                  onBlur={() => window.setTimeout(() => setExperienceOpen(false), 120)}
                  onKeyDown={(event) => {
                    if (!experienceOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                      setExperienceOpen(true);
                      return;
                    }
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setExperienceHighlight((prev) =>
                        Math.min(prev + 1, EXPERIENCE_SUGGESTIONS.length - 1)
                      );
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setExperienceHighlight((prev) => Math.max(prev - 1, 0));
                    }
                    if (event.key === "Enter" && experienceOpen) {
                      const picked = EXPERIENCE_SUGGESTIONS[experienceHighlight];
                      if (picked) {
                        event.preventDefault();
                        onExperienceLevelChange(picked);
                      }
                      setExperienceOpen(false);
                    }
                    if (event.key === "Escape") setExperienceOpen(false);
                  }}
                />
                {experienceOpen ? (
                  <div
                    id="job-experience-options"
                    role="listbox"
                    aria-label="Common experience ranges"
                    className="absolute z-20 mt-2 w-full rounded-xl border border-white/10 bg-[#0b0b0f] shadow-[0_18px_40px_-28px_rgba(0,0,0,0.9)] overflow-hidden"
                  >
                    <p className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-muted">
                      Suggestions
                    </p>
                    {EXPERIENCE_SUGGESTIONS.map((suggestion, index) => (
                      <button
                        key={suggestion}
                        id={`job-experience-option-${index}`}
                        type="button"
                        tabIndex={-1}
                        role="option"
                        aria-selected={index === experienceHighlight}
                        className={[
                          "w-full cursor-pointer text-left px-3 py-2 text-sm text-white/85",
                          index === experienceHighlight
                            ? "bg-white/10"
                            : "bg-transparent hover:bg-white/5",
                        ].join(" ")}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          onExperienceLevelChange(suggestion);
                          setExperienceOpen(false);
                        }}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </Field>
          </div>
          {basicsMessageBlock(["budgetMissing", "budgetRange"])}
        </StepCard>
      );
    }

    if (id === "arrangement") {
      return (
        <StepCard
          title="WORKING TOGETHER"
          icon="sliders-horizontal"
          bodyClassName="mt-4"
          size="compact"
          actions={actionsFor("arrangement", "basics", Boolean(canSaveDetails), onSaveDetails || onSaveBasics)}
        >
          <div className="flex flex-col gap-4">
            <Field id="job-engagement-type" label={<LabelWithIcon icon="briefcase">Engagement type</LabelWithIcon>} error={engagementError}>
              <select
                id="job-engagement-type"
                aria-label="Engagement type"
                aria-invalid={Boolean(engagementError)}
                aria-describedby={engagementError ? "job-engagement-type-error" : undefined}
                className={selectBase}
                value={engagementType}
                onChange={(event) => onEngagementTypeChange(event.target.value as EngagementType | "")}
              >
                <option value="" className="bg-[#0b0b0f]">Choose engagement type</option>
                {ENGAGEMENT_TYPES.map((value) => (
                  <option key={value} value={value} className="bg-[#0b0b0f]">
                    {engagementLabel(value)}
                  </option>
                ))}
              </select>
            </Field>

            <div className={workMode === "Hybrid" || workMode === "On-site" ? "grid gap-4 sm:grid-cols-2" : "max-w-full sm:max-w-[520px]"}>
              <Field
                id="job-work-mode"
                label={
                  <LabelWithIcon icon="laptop">
                    Work mode <span className="text-muted">*</span>
                  </LabelWithIcon>
                }
                error={workModeError}
              >
                <div className="relative">
                  <Icon name="globe" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/70" />
                  <select
                    id="job-work-mode"
                    aria-label="Work mode"
                    aria-required="true"
                    aria-invalid={Boolean(workModeError)}
                    aria-describedby={workModeError ? "job-work-mode-error" : undefined}
                    className={[basicsSelectBase, "w-full appearance-none pl-9 pr-9", workModeError ? invalidClass : ""].join(" ")}
                    value={workMode}
                    onChange={(e) => {
                      const next = e.target.value as WorkMode;
                      onWorkModeChange(next);
                      if (next === "Remote") onCityChange("");
                    }}
                  >
                    <option value="" className="bg-[#0b0b0f]">
                      Choose work mode
                    </option>
                    {(["Remote", "Hybrid", "On-site"] as const).map((m) => (
                      <option key={m} value={m} className="bg-[#0b0b0f]">
                        {m}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-lg leading-none text-white/70">
                    ⌄
                  </span>
                </div>
              </Field>

              {workMode === "Hybrid" || workMode === "On-site" ? (
                <Field
                  id="job-city"
                  label={
                    <span className="inline-flex items-center gap-1">
                      City <span className="text-muted">*</span>
                    </span>
                  }
                  error={cityError}
                >
                  <div className="relative">
                    <input
                      id="job-city"
                      role="combobox"
                      aria-autocomplete="list"
                      aria-expanded={cityOpen}
                      aria-controls="job-city-options"
                      aria-label="City"
                      aria-required="true"
                      aria-invalid={Boolean(cityError)}
                      aria-activedescendant={
                        cityOpen && citySuggestions[cityHighlight]
                          ? `job-city-option-${cityHighlight}`
                          : undefined
                      }
                      aria-describedby={cityError ? "job-city-error" : undefined}
                      className={[basicsInputBase, cityError ? invalidClass : ""].join(" ")}
                      placeholder="e.g. Chennai"
                      value={city}
                      onChange={(e) => {
                        onCityChange(e.target.value);
                        if (!cityOpen) setCityOpen(true);
                        setCityHighlight(0);
                      }}
                      onFocus={() => {
                        setCityOpen(true);
                        setCityHighlight(0);
                      }}
                      onBlur={() => {
                        window.setTimeout(() => setCityOpen(false), 120);
                        if (cityMatch && city !== cityMatch) onCityChange(cityMatch);
                      }}
                      onKeyDown={(e) => {
                        if (!cityOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                          setCityOpen(true);
                          return;
                        }
                        if (!citySuggestions.length) return;
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setCityHighlight((prev) => Math.min(prev + 1, citySuggestions.length - 1));
                        }
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setCityHighlight((prev) => Math.max(prev - 1, 0));
                        }
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const nextCity = citySuggestions[cityHighlight];
                          if (nextCity) {
                            onCityChange(nextCity);
                            setCityOpen(false);
                          }
                        }
                        if (e.key === "Escape") {
                          setCityOpen(false);
                        }
                      }}
                    />
                    {cityOpen && citySuggestions.length ? (
                      <div id="job-city-options" role="listbox" className="absolute z-20 mt-2 w-full rounded-xl border border-white/10 bg-[#0b0b0f] shadow-[0_18px_40px_-28px_rgba(0,0,0,0.9)] overflow-hidden">
                        {citySuggestions.map((c, idx) => (
                          <button
                            key={c}
                            id={`job-city-option-${idx}`}
                            type="button"
                            tabIndex={-1}
                            role="option"
                            aria-selected={idx === cityHighlight}
                            className={[
                              "w-full cursor-pointer text-left px-3 py-2 text-sm text-white/85",
                              idx === cityHighlight ? "bg-white/10" : "bg-transparent hover:bg-white/5",
                            ].join(" ")}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              onCityChange(c);
                              setCityOpen(false);
                            }}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </Field>
              ) : null}
            </div>
            {basicsMessageBlock(["workMode", "city", "cityInvalid"])}

            {engagementType && engagementType !== "one_time_project" ? (
              <Field id="job-weekly-hours-min" label={<LabelWithIcon icon="clock">Expected weekly hours</LabelWithIcon>} optional error={weeklyHoursError}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    id="job-weekly-hours-min"
                    className={inputBase}
                    aria-label="Minimum expected weekly hours"
                    aria-invalid={Boolean(weeklyHoursError)}
                    aria-describedby={weeklyHoursError ? "job-weekly-hours-min-error" : undefined}
                    placeholder="Minimum hours"
                    inputMode="decimal"
                    value={expectedWeeklyHoursMin}
                    onChange={(event) => onExpectedWeeklyHoursMinChange(decimalText(event.target.value))}
                  />
                  <input
                    className={inputBase}
                    aria-label="Maximum expected weekly hours"
                    aria-invalid={Boolean(weeklyHoursError)}
                    aria-describedby={weeklyHoursError ? "job-weekly-hours-min-error" : undefined}
                    placeholder="Maximum hours"
                    inputMode="decimal"
                    value={expectedWeeklyHoursMax}
                    onChange={(event) => onExpectedWeeklyHoursMaxChange(decimalText(event.target.value))}
                  />
                </div>
              </Field>
            ) : null}

            {showTurnaround ? (
            <Field id="job-turnaround-value" label={<LabelWithIcon icon="clock">Turnaround</LabelWithIcon>} optional error={turnaroundError}>
              <div className="grid gap-3 sm:grid-cols-3">
                <input
                  id="job-turnaround-value"
                  className={inputBase}
                  aria-label="Turnaround value"
                  aria-invalid={Boolean(turnaroundError)}
                  aria-describedby={turnaroundError ? "job-turnaround-value-error" : undefined}
                  placeholder="5"
                  inputMode="numeric"
                  value={turnaround?.value ? String(turnaround.value) : ""}
                  onChange={(e) => {
                    const raw = onlyDigits(e.target.value);
                    const nextVal = raw ? Number(raw) : null;
                    if (!nextVal) {
                      onTurnaroundChange(null);
                      return;
                    }
                    onTurnaroundChange({
                      value: nextVal,
                      unit: turnaround?.unit || "",
                      basis: turnaround?.basis || "",
                    });
                  }}
                />

                <select
                  className={selectBase}
                  aria-label="Turnaround unit"
                  aria-invalid={Boolean(turnaroundError)}
                  aria-describedby={turnaroundError ? "job-turnaround-value-error" : undefined}
                  value={turnaround?.unit ?? ""}
                  onChange={(e) => {
                    const unit = e.target.value as TurnaroundUnit;
                    if (!unit) {
                      onTurnaroundChange(null);
                      return;
                    }
                    const value = turnaround?.value || 0;
                    onTurnaroundChange({ value, unit, basis: turnaround?.basis || "" });
                  }}
                >
                  <option value="" className="bg-[#0b0b0f]">Choose unit</option>
                  {TURNAROUND_UNITS.map((u) => (
                    <option key={u} value={u} className="bg-[#0b0b0f]">
                      {u.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>

                <select
                  className={selectBase}
                  aria-label="Turnaround basis"
                  aria-invalid={Boolean(turnaroundError)}
                  aria-describedby={turnaroundError ? "job-turnaround-value-error" : undefined}
                  value={turnaround?.basis || ""}
                  onChange={(event) => {
                    if (!turnaround) return;
                    onTurnaroundChange({ ...turnaround, basis: event.target.value as TurnaroundBasis | "" });
                  }}
                >
                  <option value="" className="bg-[#0b0b0f]">Choose basis</option>
                  {TURNAROUND_BASES.map((value) => (
                    <option key={value} value={value} className="bg-[#0b0b0f]">
                      {value.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            ) : null}

            <ArrangementDomainFields
              state={domain}
              onChange={onDomainChange}
              errors={domainErrors}
              engagementType={engagementType}
              workMode={workMode}
              compensationUnit={budgetUnit}
            />
            {listingSchemaVersion != null && listingSchemaVersion < 3 && startWithin && !domain.startTiming ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2.5 text-xs leading-5 text-muted">
                Earlier start window: <span className="font-semibold text-white/78">{startWithin}</span>. It is preserved until you choose the clearer start timing above.
              </div>
            ) : null}
          </div>
        </StepCard>
      );
    }

    if (id === "creatorContext") {
      return (
        <StepCard
          title="CREATOR CONTEXT"
          icon="sparkles"
          bodyClassName="mt-4"
          size="compact"
          actions={
            <StepActions
              id="creatorContext"
              saveKey="tags"
              canSave={Boolean(canSaveCreatorContext)}
              onSave={onSaveCreatorContext}
              canGoBack={hasBack}
              canGoNext={hasNext}
              onBack={onBack}
              onNext={onNext}
              isBusy={isSubmitting}
              savedSection={savedSection}
              onSaveClick={handleSave}
              onSaveDraft={onSaveDraft}
              saveDraftLabel={saveDraftLabel}
            />
          }
        >
          <div className="flex flex-col gap-4">
            <CreatorContextChipField
              label="Content niches"
              helper="Choose the content areas this job is for."
              icon="sparkles"
              value={contentNiches}
              suggestions={CONTENT_NICHE_SUGGESTIONS}
              targetId="job-content-niches"
              onChange={onContentNichesChange}
            />
            <CreatorContextChipField
              label="Genres"
              helper="Select the content styles this role supports."
              icon="layers"
              value={contentGenres}
              suggestions={CONTENT_GENRE_SUGGESTIONS}
              targetId="job-content-genres"
              onChange={onContentGenresChange}
            />
            <CreatorContextChipField
              label="Formats hired for"
              helper="Choose the deliverables this job needs."
              icon="layout-grid"
              value={formatsHiredFor}
              suggestions={FORMATS_HIRED_FOR_SUGGESTIONS}
              targetId="job-formats-hired-for"
              onChange={onFormatsHiredForChange}
            />
          </div>
        </StepCard>
      );
    }

    if (id === "skills") {
      return (
        <StepCard
          title="SKILLS"
          icon="sliders-horizontal"
          bodyClassName="mt-4"
          size="compact"
          actions={actionsFor("skills", "tags", Boolean(canSaveCreatorContext), onSaveCreatorContext)}
        >
          <SkillsQualificationsFields
            state={domain}
            onChange={onDomainChange}
            errors={domainErrors}
            roleName={selectedRoleName}
            legacyLanguages={languages}
            sections={["skills"]}
          />
        </StepCard>
      );
    }

    if (id === "toolsLanguages") {
      return (
        <StepCard
          title="TOOLS & TAGS"
          icon="sliders-horizontal"
          bodyClassName="mt-4"
          size="compact"
          actions={actionsFor("toolsLanguages", "tags", Boolean(canSaveCreatorContext), onSaveCreatorContext)}
        >
          <div className="flex flex-col gap-5">
            <div data-quality-target="job-tools">
              {legacyToolsNotCaptured ? (
                <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2.5 text-xs leading-5 text-muted">
                  Required tools were not captured on this older listing. Leaving this untouched preserves that unknown state.
                </div>
              ) : null}
              <ToolPicker
                value={tools}
                onChange={onToolsChange}
                inputId="post-job-tools-picker"
                className="space-y-3"
                placeholder="Premiere Pro, After Effects, CapCut, DaVinci Resolve..."
              />
            </div>

            {tagsFields}
          </div>
        </StepCard>
      );
    }

    if (id === "about") {
      return (
        <StepCard
          title="About"
          icon="notebook-text"
          bodyClassName="mt-4"
          size="compact"
          actions={actionsFor(
            "about",
            "content",
            Boolean(typeof canSaveAbout === "boolean" ? canSaveAbout : canSaveContent),
            onSaveAbout || onSaveContent
          )}
        >
          <div className="flex flex-col gap-4">
            <Field
              id="job-about-brand"
              label={
                <span className="inline-flex items-center gap-1.5">
                  <LabelWithIcon icon="file">About the brand</LabelWithIcon>
                  <span className="text-muted">*</span>
                </span>
              }
              error={aboutError}
            >
              <div className="flex flex-col gap-3" data-quality-target="job-description">
                <textarea
                  id="job-about-brand"
                  aria-label="About the hiring brand or creator"
                  aria-required="true"
                  aria-invalid={Boolean(aboutError)}
                  aria-describedby={aboutError ? "job-about-brand-error" : undefined}
                  className={textareaBase}
                  placeholder={aboutPlaceholder}
                  value={about}
                  onChange={(e) => {
                    onAboutChange(e.target.value);
                  }}
                />
              </div>
            </Field>

            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-white/80">
                <LabelWithIcon icon="list-checks">Day-to-day responsibilities</LabelWithIcon>
              </div>
              <div className="flex flex-col gap-3 rounded-2xl" data-quality-target="job-responsibilities">
                <BulletListEditor
                  ariaLabel="Responsibility"
                  value={responsibilities}
                  onChange={onResponsibilitiesChange}
                  ghostLines={[
                    "Edit 3-5 Shorts per week",
                    "Create thumbnails for weekly uploads",
                    "Research trends to shape upcoming video topics",
                  ]}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-white/80">
                <LabelWithIcon icon="clipboard-check">Experience or portfolio expectations</LabelWithIcon>
              </div>
              <div className="flex flex-col gap-3 rounded-2xl" data-quality-target="job-requirements">
                <BulletListEditor
                  ariaLabel="Experience or portfolio expectation"
                  value={requirements}
                  onChange={onRequirementsChange}
                  ghostLines={[
                    "Show two examples with a similar audience or format",
                    "Experience taking feedback through a revision cycle",
                    "A portfolio that makes your contribution clear",
                  ]}
                />
              </div>
            </div>
          </div>
        </StepCard>
      );
    }

    if (id === "deliverables") {
      return (
        <StepCard
          title="DELIVERABLES"
          icon="notebook-text"
          bodyClassName="mt-4"
          size="compact"
          actions={actionsFor(
            "deliverables",
            "content",
            Boolean(typeof canSaveAbout === "boolean" ? canSaveAbout : canSaveContent),
            onSaveAbout || onSaveContent
          )}
        >
          <WorkDeliverablesFields
            state={domain}
            onChange={onDomainChange}
            errors={domainErrors}
            roleName={selectedRoleName}
            engagementType={engagementType}
            sections={["deliverables"]}
          />
        </StepCard>
      );
    }

    if (id === "workflow") {
      return (
        <StepCard
          title="WORKFLOW"
          icon="notebook-text"
          bodyClassName="mt-4"
          size="compact"
          actions={actionsFor(
            "workflow",
            "content",
            Boolean(typeof canSaveAbout === "boolean" ? canSaveAbout : canSaveContent),
            onSaveAbout || onSaveContent
          )}
        >
          <WorkDeliverablesFields
            state={domain}
            onChange={onDomainChange}
            errors={domainErrors}
            roleName={selectedRoleName}
            engagementType={engagementType}
            sections={["workflow"]}
          />
        </StepCard>
      );
    }

    if (id === "trial") {
      return (
        <StepCard
          title="TRIAL"
          icon="clipboard-list"
          bodyClassName="mt-4"
          size="compact"
          actions={actionsFor("trial", "content", Boolean(canSaveApplicationRequirements), onSaveApplicationRequirements)}
        >
          <TrialApplicationFields {...trialApplicationProps} sections={["trial"]} />
        </StepCard>
      );
    }

    if (id === "process") {
      return (
        <StepCard
          title="EVALUATION"
          icon="clipboard-list"
          bodyClassName="mt-4"
          size="compact"
          actions={actionsFor("process", "content", Boolean(canSaveApplicationRequirements), onSaveApplicationRequirements)}
        >
          <TrialApplicationFields {...trialApplicationProps} sections={["process"]} />
        </StepCard>
      );
    }

    if (id === "apply") {
      return (
        <StepCard
          title="APPLICATION REQUIREMENTS"
          icon="clipboard-list"
          bodyClassName="mt-4"
          size="compact"
          actions={actionsFor("apply", "content", Boolean(canSaveApplicationRequirements), onSaveApplicationRequirements)}
        >
          <div className="flex flex-col gap-4">
            <TrialApplicationFields {...trialApplicationProps} sections={["apply"]} />

            <div className="flex flex-col gap-3" data-quality-target="job-first-message">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-[0.04em] text-white/80">
                  <LabelWithIcon icon="clipboard-list">What applicants must include</LabelWithIcon>
                </h3>
              </div>
              <RequirementSelector
                context="job"
                selectedKeys={applicationRequirements}
                onChange={onApplicationRequirementsChange}
                noneSelected={noFirstMessageRequirements}
                onNoneChange={onNoFirstMessageRequirementsChange}
                customInstructionValue={howToApply}
                onCustomInstructionChange={onHowToApplyChange}
                customInstructionError={customInstructionError}
                hideCustomInstruction
              />
              {applicationRequirements.includes(CUSTOM_INSTRUCTION_REQUIREMENT_KEY) ? (
                <div className="rounded-2xl border border-amber-200/20 bg-amber-200/[0.07] p-3.5">
                  <label htmlFor="legacy-job-screening-prompt" className="text-xs font-semibold text-amber-50/90">
                    Previously saved first-message prompt
                  </label>
                  <p className="mt-1 text-[11px] leading-4 text-amber-100/65">
                    This older prompt is preserved separately. New screening questions are managed above.
                  </p>
                  <textarea
                    id="legacy-job-screening-prompt"
                    className={`${textareaBase} mt-2 min-h-[84px]`}
                    value={howToApply}
                    onChange={(event) => onHowToApplyChange(event.target.value)}
                  />
                  <button
                    type="button"
                    className="mt-2 min-h-9 rounded-lg border border-amber-100/25 px-3 text-xs font-semibold text-amber-50 transition-colors hover:bg-amber-100/10"
                    onClick={() => {
                      onApplicationRequirementsChange(
                        applicationRequirements.filter((key) => key !== CUSTOM_INSTRUCTION_REQUIREMENT_KEY)
                      );
                      onHowToApplyChange("");
                    }}
                  >
                    Remove saved prompt
                  </button>
                </div>
              ) : null}
              {firstMessageError && !customInstructionError ? (
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-amber-200/90">
                  <Icon name="alert" className="h-3.5 w-3.5" />
                  <span>{firstMessageError}</span>
                </div>
              ) : null}
            </div>
          </div>
        </StepCard>
      );
    }

    if (id === "references") {
      return (
        <StepCard
          bodyClassName="mt-0"
          size="compact"
          actions={actionsFor("references", "refs", Boolean(canSaveReferenceVideos), onSaveReferenceVideos)}
        >
          <div className="space-y-4">
            <p className="text-xs leading-5 text-muted">
              A strong reference helps candidates match your taste. You can publish without one.
            </p>
            {referenceVideoFields}
          </div>
        </StepCard>
      );
    }

    return (
      <StepCard
        bodyClassName="mt-0"
        size="compact"
        actions={
          <StepActions
            id="review"
            saveKey="refs"
            canSave={Boolean(canSaveReferenceVideos)}
            onSave={onSaveReferenceVideos}
            canGoBack={hasBack}
            canGoNext
            onBack={onBack}
            onNext={onNext}
            nextType="submit"
            nextIcon={<Icon name="globe" className="w-4 h-4" />}
            nextLabel={isSubmitting ? "Saving…" : publishLabel}
            nextAriaLabel={isSubmitting ? "Saving listing" : publishLabel}
            nextDisabled={publishDisabled}
            isBusy={isSubmitting}
            savedSection={savedSection}
            onSaveClick={handleSave}
            onSaveDraft={onSaveDraft}
            saveDraftLabel={saveDraftLabel}
          />
        }
      >
        <div className="space-y-6">
          {reviewPreview ? (
            <section aria-labelledby="job-review-preview-title" className="space-y-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-subtle">Candidate view</p>
                <h2 id="job-review-preview-title" className="mt-1 text-xl font-extrabold tracking-tight text-white">
                  Review before publishing
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted">
                  This preview uses the same information candidates need to judge the opportunity.
                </p>
              </div>
              {reviewPreview}
            </section>
          ) : null}
        </div>
      </StepCard>
    );
  };

  return (
    <div className="space-y-6">
      {!guidedMode ? (
        <section className="rounded-3xl bg-white/[0.06] border border-white/10 p-6 sm:p-7 shadow-[0_18px_60px_-40px_rgba(0,0,0,0.95)]">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-[1.05]">POST A JOB</h1>
          <div
            className="mt-4 h-[3px] w-full overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-label="Job posting progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
            aria-valuetext={`${progressPercent}% complete`}
          >
            <div
              className="h-full rounded-full bg-white/45 transition-[width] duration-500 ease-out motion-reduce:transition-none"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </section>
      ) : (
        <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/38">
          Your answer in Post Job
        </p>
      )}

      {submitError ? (
        <section role="alert" className="rounded-2xl border border-amber-200/20 bg-amber-200/10 px-4 py-3 text-sm text-amber-50">
          {submitError}
        </section>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-6 pb-28 sm:pb-0">
        <div className="relative min-h-[420px]">
          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <AnimatedStep key={step} direction={direction} flowLayout>
              {renderScreen(step)}
            </AnimatedStep>
          </AnimatePresence>
        </div>

        <StepActions
          id={step}
          variant="mobile-fixed"
          canSave={false}
          canGoBack={hasBack}
          canGoNext
          onBack={onBack}
          onNext={onNext}
          nextType={hasNext ? "button" : "submit"}
          nextLabel={hasNext ? "Continue" : isSubmitting ? "Saving…" : publishLabel}
          nextIcon={hasNext ? undefined : <Icon name="globe" className="h-4 w-4" />}
          nextAriaLabel={hasNext ? "Continue" : isSubmitting ? "Saving listing" : publishLabel}
          nextDisabled={!hasNext && publishDisabled}
          isBusy={isSubmitting}
          savedSection={savedSection}
          onSaveClick={handleSave}
          onSaveDraft={onSaveDraft}
          saveDraftLabel={saveDraftLabel}
          saveDraftIcon={<Icon name="file" className="h-4 w-4" />}
        />

      </form>
    </div>
  );
}
