"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icons";

const MAX_CUSTOM_LENGTH = 40;

const existsIn = (list: string[], value: string) =>
  list.some((item) => item.toLowerCase() === value.toLowerCase());

const dedupeList = (values: string[]): string[] => {
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value || existsIn(out, value)) continue;
    out.push(value);
  }
  return out;
};

/**
 * Generic, premium chip editor for a single profile field (talent OR recruiter).
 *
 * Each instance owns its own draft (`selected`) initialized from `initialSelected`
 * on mount, so opening one field's editor never bleeds into another. A single input
 * doubles as both the suggestion filter and the custom-entry box: whatever you type
 * can be added with Enter or a prominent "Add ..." button, so it's always clear that
 * the field accepts free text and isn't limited to the suggestion chips. Validation
 * covers trim / empty / duplicate / length / max. Persistence stays with the parent
 * via `onSave(values)`.
 *
 * `reuseSource` renders a subtle "copy from the other side" affordance that prefills
 * the draft (editable before saving) — talent and recruiter data stay separate by
 * default, but a user can opt in to reuse one side's values on the other.
 */
export function ChipSelectEditor({
  title,
  suggestions,
  initialSelected,
  allowCustom = false,
  customPlaceholder,
  maxSelected,
  searchable,
  searchPlaceholder,
  saving = false,
  panelId,
  reuseSource,
  normalizeValue,
  validateValue,
  onSave,
  onCancel,
}: {
  title: string;
  suggestions: readonly string[];
  initialSelected: string[];
  allowCustom?: boolean;
  customPlaceholder?: string;
  maxSelected?: number;
  searchable?: boolean;
  searchPlaceholder?: string;
  saving?: boolean;
  panelId?: string;
  reuseSource?: { label: string; values: string[] };
  normalizeValue?: (value: string) => string;
  validateValue?: (value: string, existing: string[]) => string | null;
  onSave: (values: string[]) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(() => dedupeList(initialSelected));
  const [query, setQuery] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // One input serves as both filter and custom-entry, so it shows whenever the field
  // accepts typing (custom values) or has enough suggestions to be worth filtering.
  const showInput = allowCustom || (searchable ?? suggestions.length > 8);
  const reuseValues = reuseSource ? dedupeList(reuseSource.values) : [];

  // Focus the input when the editor opens, and let Escape cancel.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const trimmedQuery = query.trim();
  const filteredSuggestions = useMemo(() => {
    const q = trimmedQuery.toLowerCase();
    return suggestions.filter(
      (suggestion) =>
        !existsIn(selected, suggestion) &&
        (!q || suggestion.toLowerCase().includes(q))
    );
  }, [trimmedQuery, selected, suggestions]);

  const atMax = typeof maxSelected === "number" && selected.length >= maxSelected;

  const addValue = (raw: string): boolean => {
    const value = normalizeValue ? normalizeValue(raw) : raw.trim();
    if (!value) {
      setValidationError("Enter a value.");
      return false;
    }
    const customError = validateValue?.(value, selected);
    if (customError) {
      setValidationError(customError);
      return false;
    }
    if (value.length > MAX_CUSTOM_LENGTH) {
      setValidationError(`Keep entries under ${MAX_CUSTOM_LENGTH} characters.`);
      return false;
    }
    if (existsIn(selected, value)) {
      setValidationError(`"${value}" is already added.`);
      return false;
    }
    if (atMax) {
      setValidationError(`You can add up to ${maxSelected}.`);
      return false;
    }
    setSelected((prev) => [...prev, value]);
    setValidationError(null);
    return true;
  };

  const removeValue = (value: string) => {
    setSelected((prev) => prev.filter((item) => item !== value));
    setValidationError(null);
  };

  // Whether the typed text is a brand-new custom value (not an existing chip/suggestion).
  const canAddCustom =
    allowCustom &&
    trimmedQuery.length > 0 &&
    !existsIn(selected, trimmedQuery) &&
    !suggestions.some((suggestion) => suggestion.toLowerCase() === trimmedQuery.toLowerCase());

  const commitInput = () => {
    if (!trimmedQuery) return;
    if (allowCustom) {
      if (addValue(trimmedQuery)) setQuery("");
      return;
    }
    if (filteredSuggestions.length === 1 && addValue(filteredSuggestions[0])) {
      setQuery("");
    }
  };

  const applyReuse = () => {
    if (!reuseValues.length) return;
    let nextError: string | null = null;
    const merged = [...selected];
    for (const raw of reuseValues) {
      const value = normalizeValue ? normalizeValue(raw) : raw.trim();
      const validationError = validateValue?.(value, merged);
      if (validationError) {
        nextError = validationError;
        continue;
      }
      if (!value || existsIn(merged, value)) continue;
      merged.push(value);
    }
    const deduped = dedupeList(merged);
    setSelected(typeof maxSelected === "number" ? deduped.slice(0, maxSelected) : deduped);
    setValidationError(nextError);
  };

  return (
    <div
      id={panelId}
      role="group"
      aria-label={title}
      className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3"
    >
      {reuseValues.length ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={applyReuse}
            title={reuseSource?.label}
            className="shrink-0 cursor-pointer whitespace-nowrap rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            {reuseSource?.label}
          </button>
        </div>
      ) : null}

      {selected.length ? (
        <div className="flex flex-wrap gap-1.5" role="list" aria-label={`Selected ${title.toLowerCase()}`}>
          {selected.map((value) => (
            <span
              key={`chip-selected-${value}`}
              role="listitem"
              className="inline-flex items-center gap-1 rounded-full border border-white/25 bg-white/[0.1] py-1 pl-2.5 pr-1 text-xs text-white"
            >
              {value}
              <button
                type="button"
                onClick={() => removeValue(value)}
                aria-label={`Remove ${value}`}
                className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/15 hover:text-white"
              >
                <Icon name="x" className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {showInput ? (
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitInput();
            }
          }}
          placeholder={
            allowCustom
              ? customPlaceholder ?? "Type to add your own — or pick a suggestion below"
              : searchPlaceholder ?? `Search ${title.toLowerCase()}`
          }
          aria-label={allowCustom ? `Add ${title.toLowerCase()}` : `Search ${title.toLowerCase()}`}
          className="h-9 w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/15"
        />
      ) : null}

      {canAddCustom ? (
        <button
          type="button"
          onClick={commitInput}
          className="flex w-full cursor-pointer items-center gap-1.5 rounded-lg border border-white/20 bg-white/[0.06] px-3 py-2 text-left text-xs font-medium text-white transition-colors hover:bg-white/[0.1]"
        >
          <Icon name="plus" className="h-3.5 w-3.5" />
          Add “{trimmedQuery}”
        </button>
      ) : null}

      {filteredSuggestions.length ? (
        <div className="flex flex-wrap gap-1.5">
          {filteredSuggestions.map((suggestion) => (
            <button
              key={`chip-suggestion-${suggestion}`}
              type="button"
              onClick={() => addValue(suggestion)}
              className="cursor-pointer rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              + {suggestion}
            </button>
          ))}
        </div>
      ) : null}

      {validationError ? (
        <p role="alert" className="text-xs text-rose-300/90">
          {validationError}
        </p>
      ) : null}

      <EditorActions title={title} saving={saving} onCancel={onCancel} onSave={() => onSave(selected)} />
    </div>
  );
}

/**
 * Single-value chip picker for a field with a small, known set of answers
 * (e.g. project type, turnaround, revisions, work mode). The preset chips show
 * exactly what a good answer looks like — so the field is self-explanatory without
 * a tutorial. `allowCustom` adds an optional free-text box for anything not listed;
 * the typed value deselects the presets and vice-versa, so there's always one
 * unambiguous answer.
 */
type ChoiceOption = { value: string; label: string };

export function SingleChoiceChips({
  label,
  options,
  value,
  onChange,
  allowCustom = false,
  customPlaceholder,
}: {
  label: string;
  options: readonly (string | ChoiceOption)[];
  value: string;
  onChange: (value: string) => void;
  allowCustom?: boolean;
  customPlaceholder?: string;
}) {
  const normalized: ChoiceOption[] = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option
  );
  const isCustom = value.trim().length > 0 && !normalized.some((option) => option.value === value);

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-white/70">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {normalized.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={`choice-${label}-${option.value}`}
              type="button"
              onClick={() => onChange(active ? "" : option.value)}
              aria-pressed={active}
              className={[
                "cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/15",
                active
                  ? "border-white/30 bg-white/[0.1] text-white"
                  : "border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.08] hover:text-white",
              ].join(" ")}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {allowCustom ? (
        <input
          value={isCustom ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder={customPlaceholder ?? "Or type your own"}
          aria-label={`Custom ${label.toLowerCase()}`}
          className="h-9 w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/15"
        />
      ) : null}
    </div>
  );
}

/**
 * Working-hours control shared by the talent work-preferences and recruiter
 * work-model editors. A Flexible / Set hours toggle keeps the simple case simple;
 * choosing "Set hours" reveals start/end times and a timezone box with quick-picks.
 */
export function WorkingHoursField({
  label = "Working hours",
  mode,
  start,
  end,
  timezone,
  onModeChange,
  onStartChange,
  onEndChange,
  onTimezoneChange,
  timezonePresets = ["IST", "GMT", "EST", "PST"],
}: {
  label?: string;
  mode: "flexible" | "fixed";
  start: string;
  end: string;
  timezone: string;
  onModeChange: (mode: "flexible" | "fixed") => void;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
  timezonePresets?: readonly string[];
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-white/70">{label}</p>
      <div className="inline-flex rounded-full border border-white/12 bg-white/[0.035] p-1">
        {(
          [
            ["flexible", "Flexible"],
            ["fixed", "Set hours"],
          ] as const
        ).map(([modeValue, modeLabel]) => (
          <button
            key={`working-hours-mode-${modeValue}`}
            type="button"
            onClick={() => onModeChange(modeValue)}
            aria-pressed={mode === modeValue}
            className={[
              "h-8 cursor-pointer rounded-full px-3 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/15",
              mode === modeValue ? "bg-white text-black" : "text-white/56 hover:text-white",
            ].join(" ")}
          >
            {modeLabel}
          </button>
        ))}
      </div>
      {mode === "fixed" ? (
        <div className="space-y-2">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(120px,0.8fr)]">
            <input
              type="time"
              value={start}
              onChange={(event) => onStartChange(event.target.value)}
              aria-label="Working hours start"
              className="h-10 w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white"
            />
            <input
              type="time"
              value={end}
              onChange={(event) => onEndChange(event.target.value)}
              aria-label="Working hours end"
              className="h-10 w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white"
            />
            <input
              value={timezone}
              onChange={(event) => onTimezoneChange(event.target.value)}
              aria-label="Timezone"
              placeholder="IST"
              className="h-10 w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {timezonePresets.map((tz) => (
              <button
                key={`working-hours-tz-${tz}`}
                type="button"
                onClick={() => onTimezoneChange(tz)}
                className="cursor-pointer rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
              >
                {tz}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Shared Cancel / Save footer matching the recruiter inline-editor styling.
 */
export function EditorActions({
  title,
  saving = false,
  onCancel,
  onSave,
}: {
  title: string;
  saving?: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="mt-1 flex items-center justify-end gap-3">
      <button
        type="button"
        onClick={onCancel}
        className="cursor-pointer text-xs font-medium text-white/48 transition-colors hover:text-white"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        aria-label={`Save ${title.toLowerCase()}`}
        title={`Save ${title.toLowerCase()}`}
        className={[
          "inline-flex h-10 w-10 items-center justify-center rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/15 disabled:cursor-not-allowed disabled:opacity-55",
          saving ? "bg-white/20 text-white/45" : "cursor-pointer bg-white text-black hover:bg-white/90",
        ].join(" ")}
      >
        <Icon name={saving ? "clock" : "check"} className="h-4 w-4" />
      </button>
    </div>
  );
}
