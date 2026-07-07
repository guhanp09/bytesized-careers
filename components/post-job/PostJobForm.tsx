"use client";

import { AnimatePresence } from "framer-motion";
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatedStep } from "../ui/StepTransition";
import { ReferenceTimestampNote, ReferenceVideo, StartTimeframe } from "../../lib/types";
import { formatStartLabel, onlyDigits } from "../../lib/format";
import { INDIA_CITIES } from "../../lib/indiaCities";
import { START_TIME_VALUES } from "../../lib/jobs";
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
import LanguagePicker from "../post-flow/LanguagePicker";
import RequirementSelector from "../first-message/RequirementSelector";
import { CUSTOM_INSTRUCTION_REQUIREMENT_KEY } from "../../lib/firstMessageRequirements";

const JOB_TITLE_MAX_LENGTH = 94;
const MAX_REFERENCE_TIMESTAMP_ROWS = 8;
const MAX_REFERENCE_VIDEOS = 3;

type Step =
  | "basics"
  | "details"
  | "creatorContext"
  | "toolsTags"
  | "about"
  | "applicationRequirements"
  | "referenceVideos";

type TurnaroundUnit = "hours" | "days" | "weeks";
type Turnaround = { value: number; unit: TurnaroundUnit } | null;
type BudgetIntent = "" | "range" | "flexible" | "contact";
type WorkMode = "" | "Remote" | "Hybrid" | "On-site";
type JobPlatform = "youtube" | "instagram";

const pill = (active: boolean) =>
  [
    "h-10 cursor-pointer px-3 rounded-xl text-sm font-semibold",
    "border border-white/12 ring-1 ring-white/5",
    "shadow-[0_12px_28px_-20px_rgba(0,0,0,0.95)]",
    "transition-all duration-150",
    active
      ? "bg-white text-black"
      : "bg-white/7 text-white/80 hover:bg-white/10 hover:text-white",
  ].join(" ");

const inputBase =
  "w-full h-11 rounded-xl bg-white/6 border border-white/10 px-3 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25 focus:bg-white/7 transition-colors";

const textareaBase =
  "w-full min-h-[110px] rounded-xl bg-white/6 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25 focus:bg-white/7 transition-colors";

const selectBase =
  "w-full h-11 cursor-pointer rounded-xl bg-white/6 border border-white/10 px-3 text-sm text-white outline-none focus:border-white/25 focus:bg-white/7 transition-colors";

const basicsInputBase =
  "w-full h-11 rounded-xl bg-white/[0.06] border border-white/10 px-3 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25 focus:bg-white/[0.075] transition-colors";

const basicsSelectBase =
  "h-11 cursor-pointer rounded-xl bg-white/[0.06] border border-white/10 px-3 text-sm text-white outline-none focus:border-white/25 focus:bg-white/[0.075] transition-colors";

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
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  ghostLines?: string[];
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
                <div className="text-sm text-white/35 leading-relaxed">{text}</div>
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

const STEP_SUBTITLES: Record<Step, string> = {
  basics: "",
  details: "Practical expectations.",
  creatorContext: "Matching details.",
  toolsTags: "Tools and discovery tags.",
  about: "You've got this.",
  applicationRequirements: "Applicant response details.",
  referenceVideos: "Final touches.",
};

type IconName = React.ComponentProps<typeof Icon>["name"];

function LabelWithIcon({
  icon,
  children,
}: {
  icon: IconName;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-semibold text-white/80">
      <Icon name={icon} className="h-4 w-4 text-white/72" />
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
  label,
  children,
  helper,
  error,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  optional?: boolean;
  helper?: string;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-white/80">{label}</div>
        {error ? (
          <div className="inline-flex items-center gap-1 text-[11px] text-amber-200/90">
            <Icon name="alert" className="w-3 h-3" />
            <span>{error}</span>
          </div>
        ) : null}
      </div>
      {children}
      {helper ? <div className="text-[11px] text-white/45">{helper}</div> : null}
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
            <div className="mt-1 text-[11px] text-white/45">Add moments candidates should jump to.</div>
          </div>
          <div className="text-[11px] text-white/38">{rows.length}/{MAX_REFERENCE_TIMESTAMP_ROWS}</div>
        </div>

        <div className="hidden grid-cols-[112px_minmax(0,0.7fr)_minmax(0,1fr)] gap-3 px-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/32 sm:grid">
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
                className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/48 transition-colors hover:bg-white/[0.08] hover:text-white"
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
            className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg px-1 text-sm font-semibold text-white/50 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Icon name="plus" className="h-4 w-4" />
            Add timestamp
          </button>
          {maxNotesReached ? <span className="text-[11px] text-white/35">Maximum 8 timestamps</span> : null}
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
  const sizeClass =
    size === "tall" ? "h-full max-h-full" : "h-auto max-h-[75vh]";

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
            <div className="text-xs text-white/45">{hint}</div>
          ) : null}
        </div>
      ) : null}
      <div
        className={[
          bodyClassName,
          "flex-1 overflow-y-auto pr-2 -mr-2",
          "pb-6",
          "[scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.25)_transparent]",
          "[&::-webkit-scrollbar]:w-2",
          "[&::-webkit-scrollbar-thumb]:rounded-full",
          "[&::-webkit-scrollbar-thumb]:bg-white/15",
          "[&::-webkit-scrollbar-track]:bg-transparent",
        ].join(" ")}
      >
        {children}
      </div>
      <div className="pt-2 mt-2 border-t border-white/5">{actions}</div>
    </section>
  );
}


function TinyChip({
  children,
  onRemove,
}: {
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
        aria-label="Remove"
        title="Remove"
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
          <div className="mt-0.5 text-[11px] text-white/42">{helper}</div>
        </div>
        <div className="text-[11px] text-white/35">{value.length}/{CREATOR_CONTEXT_MAX_ITEMS}</div>
      </div>

      {value.length ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((item) => (
            <TinyChip key={item} onRemove={() => removeValue(item)}>
              {item}
            </TinyChip>
          ))}
        </div>
      ) : null}

      <input
        className="h-9 w-full rounded-xl border border-white/10 bg-white/[0.045] px-3 text-xs text-white outline-none transition-colors placeholder:text-white/30 focus:border-white/25 focus:bg-white/[0.065]"
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
  saveDraftIcon?: React.ReactNode;
  savedSection: null | "basics" | "content" | "tags" | "refs";
  onSaveClick: (
    section: "basics" | "content" | "tags" | "refs",
    handler?: () => boolean | void
  ) => void;
};

function StepActions({
  id,
  saveKey,
  canSave,
  onSave,
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
  saveDraftIcon,
  savedSection,
  onSaveClick,
}: StepActionsProps) {
  const toastKey =
    saveKey ||
    (id === "basics" || id === "details"
      ? "basics"
      : id === "creatorContext" || id === "toolsTags"
        ? "tags"
        : id === "referenceVideos"
          ? "refs"
          : "content");
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
    <div className="mt-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        {onSaveDraft ? (
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={isBusy}
            className="inline-flex h-10 min-w-[116px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/[0.16] bg-white/[0.065] px-4 text-sm font-semibold text-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-[background-color,border-color,color,transform] hover:border-white/25 hover:bg-white/[0.095] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101014] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55"
          >
            {saveDraftIcon}
            SAVE DRAFT
          </button>
        ) : null}
        {canGoBack ? (
          <button
            type="button"
            onClick={() => onBack(id)}
            className="h-9 w-9 inline-flex cursor-pointer items-center justify-center rounded-xl bg-white text-black border border-white hover:bg-white/90 transition-colors disabled:cursor-not-allowed disabled:opacity-55"
            aria-label="Back"
            title="Back"
            disabled={isBusy}
          >
            <span className="text-sm leading-none">←</span>
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {savedSection === toastKey ? (
          <div className="rounded-lg bg-white/10 border border-white/15 px-3 py-1 text-xs text-white/90 shadow-[0_12px_30px_-22px_rgba(0,0,0,0.9)] backdrop-blur">
            Saved
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => onSaveClick(toastKey, onSave)}
          className={[
            "h-9 w-9 inline-flex items-center justify-center rounded-xl border transition-colors",
            canSave && !isBusy
              ? "cursor-pointer bg-white text-black border-white hover:bg-white/90"
              : "cursor-not-allowed bg-white/6 text-white/40 border-white/10",
          ].join(" ")}
          aria-label="Save"
          title={canSave ? "Save" : undefined}
          disabled={!canSave || isBusy}
        >
          <Icon name="check" className="w-4 h-4" />
        </button>
        {canGoNext ? (
          <button
            type={nextType}
            onClick={nextType === "submit" ? undefined : () => onNext(id)}
            className={[
              "inline-flex items-center justify-center rounded-xl border transition-colors",
              nextDisabled || isBusy
                ? "cursor-not-allowed border-white/10 bg-white/15 text-white/36"
                : "cursor-pointer bg-white text-black border-white hover:bg-white/90",
              nextLabel ? "h-9 px-3 gap-2" : "h-9 w-9",
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
  currentStepNumber,
  totalSteps,
  hasNext,
  hasBack,
  onNext,
  onBack,
  basicsErrors,
  contentErrors,
  title,
  onTitleChange,
  workMode,
  onWorkModeChange,
  city,
  onCityChange,
  budgetMin,
  budgetMax,
  budgetUnit,
  budgetIntent,
  onBudgetMinChange,
  onBudgetMaxChange,
  onBudgetUnitChange,
  onBudgetIntentChange,
  expMin,
  expMax,
  onExpMinChange,
  onExpMaxChange,
  startWithin,
  onStartWithinChange,
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
  tools,
  onToolsChange,
  languages,
  onLanguagesChange,
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
    Record<"title" | "city" | "cityInvalid" | "budgetMissing" | "budgetRange" | "identity" | "platform" | "workMode", string>
  >;
  contentErrors?: Partial<Record<"about", string>>;
  title: string;
  onTitleChange: (next: string) => void;
  workMode: WorkMode;
  onWorkModeChange: (next: WorkMode) => void;
  city: string;
  onCityChange: (next: string) => void;
  budgetMin: string;
  budgetMax: string;
  budgetUnit: "per project" | "per month";
  budgetIntent: BudgetIntent;
  onBudgetMinChange: (next: string) => void;
  onBudgetMaxChange: (next: string) => void;
  onBudgetUnitChange: (next: "per project" | "per month") => void;
  onBudgetIntentChange: (next: BudgetIntent) => void;
  expMin: string;
  expMax: string;
  onExpMinChange: (next: string) => void;
  onExpMaxChange: (next: string) => void;
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
}) {
  const [savedSection, setSavedSection] = useState<null | "basics" | "content" | "tags" | "refs">(null);
  const toastTimerRef = useRef<number | null>(null);
  const referenceVideoTitleRef = useRef<HTMLInputElement | null>(null);
  const previousReferenceVideoCountRef = useRef(refVideos.length);
  const stepIndex = Math.max(currentStepNumber - 1, 0);
  const displayedProgressStep = stepIndex === 0 ? 0 : stepIndex + 1;
  const progress = totalSteps ? Math.min(displayedProgressStep / totalSteps, 1) : 0;
  const [cityOpen, setCityOpen] = useState(false);
  const [cityHighlight, setCityHighlight] = useState(0);

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

  const renderStep = (id: Step) => {
    const titleError = basicsErrors?.title;
    const cityError = basicsErrors?.city || basicsErrors?.cityInvalid;
    const budgetError = basicsErrors?.budgetMissing || basicsErrors?.budgetRange;
    const platformError = basicsErrors?.platform;
    const workModeError = basicsErrors?.workMode;
    const invalidClass =
      "border-amber-200/40 ring-1 ring-amber-200/25 focus:border-amber-200/50";

    const basicsMessages = Object.entries(basicsErrors || {}).filter(([key, message]) => key !== "identity" && message);

    const tagsFields = (
      <div className="flex flex-col gap-3 rounded-2xl" data-quality-target="job-tags">
        <div className="text-xs font-semibold text-white/80">
          <LabelWithIcon icon="tag">Tags</LabelWithIcon>
        </div>
        <div className="flex gap-2">
          <input
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
              <TinyChip key={t} onRemove={() => onRemoveTag(t)}>
                {t}
              </TinyChip>
            ))
          ) : null}
        </div>
        <div className="text-xs text-white/45">
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
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">
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
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">
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
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/45">
            Maximum 3 reference videos
          </div>
        )}

        <button
          type="button"
          className={[
            "inline-flex h-16 w-full items-center justify-center gap-2 rounded-2xl",
            "border border-dashed border-white/12 bg-white/[0.025]",
            "cursor-pointer text-sm font-semibold text-white/42 transition-colors",
            "hover:border-white/20 hover:bg-white/[0.045] hover:text-white/72",
            "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/12 disabled:hover:bg-white/[0.025] disabled:hover:text-white/42",
          ].join(" ")}
          onClick={onAddRefVideo}
          disabled={!canCreateMoreReferenceVideos}
        >
          <Icon name="plus" className="h-4 w-4" />
          Add another video
        </button>
      </div>
    );

    if (id === "basics") {
      return (
        <StepCard
          title="BASICS"
          icon="briefcase"
          bodyClassName="mt-8"
          size="compact"
          actions={
            <StepActions
              id="basics"
              canSave={canSaveBasics}
              onSave={onSaveBasics}
              canGoBack={hasBack}
              canGoNext={hasNext}
              onBack={onBack}
              onNext={onNext}
              isBusy={isSubmitting}
              savedSection={savedSection}
              onSaveClick={handleSave}
              onSaveDraft={onSaveDraft}
              saveDraftIcon={<Icon name="file" className="h-4 w-4" />}
            />
          }
        >
          <div className="flex flex-col gap-6">
            <Field
              label={
                <LabelWithIcon icon="briefcase">
                  Job title <span className="text-white/50">*</span>
                </LabelWithIcon>
              }
              error={titleError}
            >
              <div className="relative">
                <input
                  aria-required="true"
                  aria-invalid={Boolean(titleError)}
                  className={[basicsInputBase, "pr-16", titleError ? invalidClass : ""].join(" ")}
                  placeholder="e.g. Video editor for YouTube (retention-focused)"
                  value={title}
                  maxLength={JOB_TITLE_MAX_LENGTH}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next.length <= JOB_TITLE_MAX_LENGTH) onTitleChange(next);
                  }}
                />
                <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs tabular-nums text-white/45">
                  {title.length}/{JOB_TITLE_MAX_LENGTH}
                </div>
              </div>
            </Field>

            <Field
              label={
                <LabelWithIcon icon="screen">
                  Platform <span className="text-white/50">*</span>
                </LabelWithIcon>
              }
              error={platformError}
            >
              <div className="flex flex-wrap gap-2">
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

            <div className={workMode === "Hybrid" || workMode === "On-site" ? "grid gap-4 sm:grid-cols-2" : "max-w-full sm:max-w-[520px]"}>
              <Field
                label={
                  <LabelWithIcon icon="laptop">
                    Work mode <span className="text-white/50">*</span>
                  </LabelWithIcon>
                }
                error={workModeError}
              >
                <div className="relative">
                  <Icon name="globe" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/70" />
                  <select
                    aria-required="true"
                    aria-invalid={Boolean(workModeError)}
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
                  label={
                    <span className="inline-flex items-center gap-1">
                      City <span className="text-white/50">*</span>
                    </span>
                  }
                  error={cityError}
                >
                  <div className="relative">
                    <input
                      aria-required="true"
                      aria-invalid={Boolean(cityError)}
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
                      <div className="absolute z-20 mt-2 w-full rounded-xl border border-white/10 bg-[#0b0b0f] shadow-[0_18px_40px_-28px_rgba(0,0,0,0.9)] overflow-hidden">
                        {citySuggestions.map((c, idx) => (
                          <button
                            key={c}
                            type="button"
                            className={[
                              "w-full text-left px-3 py-2 text-sm text-white/85",
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

            <Field
              label={
                <LabelWithIcon icon="wallet">
                  Budget <span className="text-white/50">*</span>
                </LabelWithIcon>
              }
              error={budgetError}
            >
              <div className="flex flex-wrap items-center gap-2.5 lg:flex-nowrap">
                <div className="relative min-w-[132px] flex-[1_1_160px]">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-white/72">
                    ₹
                  </span>
                  <input
                    aria-required="true"
                    aria-invalid={Boolean(budgetError)}
                    className={[basicsInputBase, "pl-9", budgetError ? invalidClass : ""].join(" ")}
                    placeholder="Min"
                    inputMode="numeric"
                    value={budgetMin}
                    onChange={(e) => {
                      onBudgetIntentChange("range");
                      onBudgetMinChange(onlyDigits(e.target.value));
                    }}
                  />
                </div>

                <span className="hidden text-base text-white/50 select-none sm:inline-flex">–</span>

                <div className="relative min-w-[132px] flex-[1_1_160px]">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-white/72">
                    ₹
                  </span>
                  <input
                    aria-required="true"
                    aria-invalid={Boolean(budgetError)}
                    className={[basicsInputBase, "pl-9", budgetError ? invalidClass : ""].join(" ")}
                    placeholder="Max"
                    inputMode="numeric"
                    value={budgetMax}
                    onChange={(e) => {
                      onBudgetIntentChange("range");
                      onBudgetMaxChange(onlyDigits(e.target.value));
                    }}
                  />
                </div>

                <div className="relative min-w-[132px] flex-[0_1_150px]">
                  <select
                    className={[basicsSelectBase, "w-full appearance-none pr-10"].join(" ")}
                    value={budgetUnit}
                    onChange={(e) => onBudgetUnitChange(e.target.value as "per project" | "per month")}
                  >
                    {(["per project", "per month"] as const).map((u) => (
                      <option key={u} value={u} className="bg-[#0b0b0f]">
                        {u}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-lg leading-none text-white/70">
                    ⌄
                  </span>
                </div>

                <button
                  type="button"
                  className={[
                    "inline-flex h-11 flex-[0_0_auto] cursor-pointer items-center justify-center gap-2 rounded-xl border px-3.5 text-sm font-semibold shadow-[0_12px_28px_-22px_rgba(0,0,0,0.95)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101014]",
                    budgetIntent === "flexible" && !budgetMin && !budgetMax
                      ? "border-white bg-white text-black hover:bg-white/92"
                      : "border-white/12 bg-white/[0.055] text-white/82 hover:border-white/22 hover:bg-white/[0.085] hover:text-white",
                  ].join(" ")}
                  onClick={() => {
                    onBudgetMinChange("");
                    onBudgetMaxChange("");
                    onBudgetIntentChange("flexible");
                  }}
                >
                  <Icon name="refresh" className="h-[18px] w-[18px]" />
                  Flexible
                </button>
                <button
                  type="button"
                  className={[
                    "inline-flex h-11 flex-[0_0_auto] cursor-pointer items-center justify-center gap-2 rounded-xl border px-3.5 text-sm font-semibold shadow-[0_12px_28px_-22px_rgba(0,0,0,0.95)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101014]",
                    budgetIntent === "contact" && !budgetMin && !budgetMax
                      ? "border-white bg-white text-black hover:bg-white/92"
                      : "border-white/12 bg-white/[0.055] text-white/82 hover:border-white/22 hover:bg-white/[0.085] hover:text-white",
                  ].join(" ")}
                  onClick={() => {
                    onBudgetMinChange("");
                    onBudgetMaxChange("");
                    onBudgetIntentChange("contact");
                  }}
                >
                  Contact for pricing
                </button>
              </div>
            </Field>

            <Field label={<LabelWithIcon icon="cap">Experience</LabelWithIcon>} optional>
              <div
                className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center"
                data-quality-target="job-experience"
              >
                <select
                  className={selectBase}
                  value={expMin}
                  onChange={(e) => {
                    const nextMin = e.target.value;
                    onExpMinChange(nextMin);
                    if (expMax && nextMin && Number(expMax) < Number(nextMin)) {
                      onExpMaxChange(nextMin);
                    }
                  }}
                >
                  <option value="" className="bg-[#0b0b0f]">
                    Min years
                  </option>
                  {Array.from({ length: 11 }, (_, i) => i).map((n) => (
                    <option key={`min-${n}`} value={String(n)} className="bg-[#0b0b0f]">
                      {n}
                    </option>
                  ))}
                </select>

                <span className="text-white/45 select-none">–</span>

                <select
                  className={selectBase}
                  value={expMax}
                  onChange={(e) => {
                    const nextMax = e.target.value;
                    onExpMaxChange(nextMax);
                    if (expMin && nextMax && Number(nextMax) < Number(expMin)) {
                      onExpMinChange(nextMax);
                    }
                  }}
                >
                  <option value="" className="bg-[#0b0b0f]">
                    Max years
                  </option>
                  {Array.from({ length: 11 }, (_, i) => i).map((n) => (
                    <option key={`max-${n}`} value={String(n)} className="bg-[#0b0b0f]">
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
          </div>
          {basicsMessages.length ? (
            <div className="mt-3 space-y-2">
              {basicsMessages.map(([, message]) => (
                <div
                  key={message}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-amber-200/90"
                >
                  <Icon name="alert" className="w-3.5 h-3.5" />
                  <span>{message}</span>
                </div>
              ))}
            </div>
          ) : null}
        </StepCard>
      );
    }

    if (id === "details") {
      return (
        <StepCard
          title="Details"
          icon="sliders-horizontal"
          bodyClassName="mt-4"
          size="compact"
          optional
          actions={
            <StepActions
              id="details"
              saveKey="basics"
              canSave={Boolean(canSaveDetails)}
              onSave={onSaveDetails || onSaveBasics}
              canGoBack={hasBack}
              canGoNext={hasNext}
              onBack={onBack}
              onNext={onNext}
              isBusy={isSubmitting}
              savedSection={savedSection}
              onSaveClick={handleSave}
              onSaveDraft={onSaveDraft}
            />
          }
        >
          <div className="flex flex-col gap-4">
            <Field label={<LabelWithIcon icon="clock">Turnaround</LabelWithIcon>} optional>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <input
                  className={inputBase}
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
                    onTurnaroundChange({ value: nextVal, unit: turnaround?.unit || "days" });
                  }}
                />

                <select
                  className={selectBase}
                  value={turnaround?.unit ?? "days"}
                  onChange={(e) => {
                    const unit = e.target.value as TurnaroundUnit;
                    if (!unit) {
                      onTurnaroundChange(null);
                      return;
                    }
                    const value = turnaround?.value || 5;
                    onTurnaroundChange({ value, unit });
                  }}
                >
                  {(["hours", "days", "weeks"] as const).map((u) => (
                    <option key={u} value={u} className="bg-[#0b0b0f]">
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </Field>

            <Field label={<LabelWithIcon icon="calendar">Start</LabelWithIcon>} optional>
              <div className="flex flex-wrap gap-2">
                {START_TIME_VALUES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={pill(startWithin === value)}
                    onClick={() => onStartWithinChange(startWithin === value ? "" : value)}
                  >
                    {formatStartLabel(value)}
                  </button>
                ))}
              </div>
            </Field>

            <div data-quality-target="job-languages">
              <LanguagePicker
                value={languages}
                onChange={onLanguagesChange}
                idPrefix="post-job"
                enableGlobalPicker
              />
            </div>
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

    if (id === "toolsTags") {
      return (
        <StepCard
          title="TOOLS & TAGS"
          icon="sliders-horizontal"
          bodyClassName="mt-4"
          size="compact"
          actions={
            <StepActions
              id="toolsTags"
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
            />
          }
        >
          <div className="flex flex-col gap-5">
            <div data-quality-target="job-tools">
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
      const aboutError = contentErrors?.about;
      const aboutTitle = "About the brand";
      const aboutPlaceholder = isRepresentedHiringIdentity
        ? "Share the content creator’s vision, audience, and why this role matters."
        : "Share your brand’s voice, audience, and why this role matters.";
      return (
        <StepCard
          title="About"
          icon="notebook-text"
          bodyClassName="mt-4"
          size="compact"
          actions={
            <StepActions
              id="about"
              saveKey="content"
              canSave={typeof canSaveAbout === "boolean" ? canSaveAbout : canSaveContent}
              onSave={onSaveAbout || onSaveContent}
              canGoBack={hasBack}
              canGoNext={hasNext}
              onBack={onBack}
              onNext={onNext}
              isBusy={isSubmitting}
              savedSection={savedSection}
              onSaveClick={handleSave}
              onSaveDraft={onSaveDraft}
            />
          }
        >
          <div className="flex flex-col gap-4">
            <Field
              label={
                <span className="inline-flex items-center gap-1.5">
                  <LabelWithIcon icon="file">{aboutTitle}</LabelWithIcon>
                  <span className="text-white/50">*</span>
                </span>
              }
              error={aboutError}
            >
              <div className="flex flex-col gap-3" data-quality-target="job-description">
                <textarea
                  aria-required="true"
                  aria-invalid={Boolean(aboutError)}
                  className={textareaBase}
                  placeholder={aboutPlaceholder}
                  value={about}
                  onChange={(e) => {
                    onAboutChange(e.target.value);
                  }}
                />
                {aboutError ? (
                  <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-amber-200/90">
                    <Icon name="alert" className="w-3.5 h-3.5" />
                    <span>{aboutError}</span>
                  </div>
                ) : null}
              </div>
            </Field>

            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-white/80">
                <LabelWithIcon icon="list-checks">Day-to-day responsibilities</LabelWithIcon>
              </div>
              <div className="flex flex-col gap-3 rounded-2xl" data-quality-target="job-responsibilities">
                <BulletListEditor
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
                <LabelWithIcon icon="clipboard-check">Requirements</LabelWithIcon>
              </div>
              <div className="flex flex-col gap-3 rounded-2xl" data-quality-target="job-requirements">
                <BulletListEditor
                  value={requirements}
                  onChange={onRequirementsChange}
                  ghostLines={[
                    "Experience with education content for 25k+ subscriber channels",
                    "Strong context-aware meme humour with proven examples",
                    "Track record of creating viral Instagram Reels",
                  ]}
                />
              </div>
            </div>
          </div>
        </StepCard>
      );
    }

    if (id === "applicationRequirements") {
      const customInstructionError =
        applicationRequirements.includes(CUSTOM_INSTRUCTION_REQUIREMENT_KEY) && !howToApply.trim()
          ? firstMessageError
          : undefined;
      return (
        <StepCard
          title="APPLICATION REQUIREMENTS"
          icon="clipboard-list"
          bodyClassName="mt-4"
          size="compact"
          actions={
            <StepActions
              id="applicationRequirements"
              saveKey="content"
              canSave={Boolean(canSaveApplicationRequirements)}
              onSave={onSaveApplicationRequirements}
              canGoBack={hasBack}
              canGoNext={hasNext}
              onBack={onBack}
              onNext={onNext}
              isBusy={isSubmitting}
              savedSection={savedSection}
              onSaveClick={handleSave}
              onSaveDraft={onSaveDraft}
            />
          }
        >
          <div className="flex flex-col gap-4">
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
              />
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

    return (
      <StepCard
        bodyClassName="mt-0"
        size="compact"
        actions={
          <StepActions
            id="referenceVideos"
            saveKey="refs"
            canSave={Boolean(canSaveReferenceVideos)}
            onSave={onSaveReferenceVideos}
            canGoBack={hasBack}
            canGoNext
            onBack={onBack}
            onNext={onNext}
            nextType="submit"
            nextIcon={<Icon name="globe" className="w-4 h-4" />}
            nextLabel={isSubmitting ? "Posting..." : "Post"}
            nextAriaLabel={isSubmitting ? "Posting job" : "Post job"}
            nextDisabled={publishDisabled}
            isBusy={isSubmitting}
            savedSection={savedSection}
            onSaveClick={handleSave}
            onSaveDraft={onSaveDraft}
          />
        }
      >
        {referenceVideoFields}
      </StepCard>
    );
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-white/[0.06] border border-white/10 p-6 sm:p-7 shadow-[0_18px_60px_-40px_rgba(0,0,0,0.95)]">
        <div className="grid items-start">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-[1.05]">POST A JOB</h1>
          <div>
            {STEP_SUBTITLES[step] ? (
              <p className="mt-4 text-sm text-white/55">{STEP_SUBTITLES[step]}</p>
            ) : null}
            <div className={STEP_SUBTITLES[step] ? "mt-2" : "mt-4"}>
              <div className="h-[3px] rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-white/45 transition-[width] duration-300 ease-out"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {submitError ? (
        <section className="rounded-2xl border border-amber-200/20 bg-amber-200/10 px-4 py-3 text-sm text-amber-50">
          {submitError}
        </section>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-6">
        <div className="relative h-[calc(100vh-260px)] overflow-hidden">
          <AnimatePresence mode="sync" initial={false} custom={direction}>
            <AnimatedStep key={step} direction={direction}>
              {renderStep(step)}
            </AnimatedStep>
          </AnimatePresence>
        </div>

      </form>
    </div>
  );
}
