"use client";

import { AnimatePresence, motion, useIsPresent } from "framer-motion";
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { StartTimeframe } from "../../lib/types";
import { VerifiedIdentity } from "../../lib/identity/types";
import { formatCompactNumber, formatStartLabel, onlyDigits } from "../../lib/format";
import { INDIA_CITIES } from "../../lib/indiaCities";
import { START_TIME_VALUES } from "../../lib/jobs";
import { Icon } from "../Icons";
import StyleSmartInput from "./StyleSmartInput";

const JOB_TITLE_MAX_LENGTH = 94;
const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

const stepVariants = {
  enter: (dir: "forward" | "back") => ({
    x: dir === "forward" ? 24 : -24,
    scale: 0.98,
    opacity: 0.85,
    transition: { duration: 0.28, ease: EASE_OUT },
  }),
  center: {
    x: 0,
    scale: 1,
    opacity: 1,
    transition: { duration: 0.3, ease: EASE_OUT },
  },
  exit: (dir: "forward" | "back") => ({
    x: dir === "forward" ? "-110%" : "110%",
    opacity: 1,
    transition: { duration: 0.28, ease: EASE_OUT },
  }),
} as const;

function AnimatedStep({
  direction,
  children,
}: {
  direction: "forward" | "back";
  children: React.ReactNode;
}) {
  const isPresent = useIsPresent();
  return (
    <motion.div
      className={["absolute inset-0", isPresent ? "" : "pointer-events-none"].join(" ")}
      style={{ zIndex: isPresent ? 1 : 2 }}
      custom={direction}
      initial="enter"
      animate="center"
      exit="exit"
      variants={stepVariants}
    >
      {children}
    </motion.div>
  );
}

type Step =
  | "basics"
  | "about"
  | "responsibilities"
  | "requirements"
  | "howToApply"
  | "referenceVideos"
  | "tags";

type TurnaroundUnit = "hours" | "days" | "weeks";
type Turnaround = { value: number; unit: TurnaroundUnit } | null;

const pill = (active: boolean) =>
  [
    "h-10 px-3 rounded-xl text-sm font-semibold",
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
  "w-full h-11 rounded-xl bg-white/6 border border-white/10 px-3 text-sm text-white outline-none focus:border-white/25 focus:bg-white/7 transition-colors";

const ghostInputBase =
  "w-full h-11 rounded-xl bg-white/6 border border-white/10 px-3 text-sm outline-none focus:border-white/25 focus:bg-white/7 transition-colors text-transparent caret-white";

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

const TOOL_SUGGESTIONS = [
  "Premiere Pro",
  "Final Cut Pro",
  "DaVinci Resolve",
  "After Effects",
  "CapCut",
  "Audition",
  "Avid",
  "Filmora",
  "Resolve Studio",
];

const PLATFORM_SUGGESTIONS = ["YouTube", "Instagram"];

const STEP_SUBTITLES: Record<Step, string> = {
  basics: "Just the essentials.",
  about: "You've got this.",
  responsibilities: "Nice pace.",
  requirements: "Halfway point.",
  howToApply: "Nearly there.",
  referenceVideos: "Final touches.",
  tags: "Ready to post.",
};


function Field({
  label,
  children,
  optional,
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
        ) : optional ? (
          <div className="text-[11px] text-white/45">Optional</div>
        ) : null}
      </div>
      {children}
      {helper ? <div className="text-[11px] text-white/45">{helper}</div> : null}
    </div>
  );
}

function StepCard({
  title,
  hint,
  optional,
  children,
  actions,
  bodyClassName = "mt-4",
  size = "compact",
}: {
  title: string;
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
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight text-white/90 uppercase">{title}</h2>
        {optional ? (
          <div className="text-xs text-white/45">Optional</div>
        ) : hint ? (
          <div className="text-xs text-white/45">{hint}</div>
        ) : null}
      </div>
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

const ghostMatch = (value: string, options: string[]) => {
  const v = value.trim().toLowerCase();
  if (!v) return "";
  const match = options.find((opt) => opt.toLowerCase().startsWith(v));
  return match || "";
};

const ghostRemainder = (value: string, suggestion: string) => {
  if (!suggestion) return "";
  if (!suggestion.toLowerCase().startsWith(value.trim().toLowerCase())) return suggestion;
  return suggestion.slice(value.length);
};

type StepActionsProps = {
  id: Step;
  canSave: boolean;
  onSave?: () => boolean | void;
  canGoBack: boolean;
  canGoNext: boolean;
  onBack: (step: Step) => void;
  onNext: (step: Step) => void;
  nextLabel?: string;
  nextIcon?: React.ReactNode;
  nextType?: "button" | "submit";
  nextDisabled?: boolean;
  isBusy?: boolean;
  savedSection: null | "basics" | "content" | "tags" | "refs";
  onSaveClick: (
    section: "basics" | "content" | "tags" | "refs",
    handler?: () => boolean | void
  ) => void;
};

function StepActions({
  id,
  canSave,
  onSave,
  canGoBack,
  canGoNext,
  onBack,
  onNext,
  nextLabel,
  nextIcon,
  nextType = "button",
  nextDisabled = false,
  isBusy = false,
  savedSection,
  onSaveClick,
}: StepActionsProps) {
  const toastKey = id === "referenceVideos" ? "refs" : id === "tags" ? "tags" : id === "basics" ? "basics" : "content";
  const nextContent = nextLabel ? (
    <>
      {nextIcon}
      <span className="text-xs font-semibold">{nextLabel}</span>
    </>
  ) : (
    <span className="text-sm leading-none">→</span>
  );
  return (
    <div className="mt-4 flex items-center justify-between">
      <div>
        {canGoBack ? (
          <button
            type="button"
            onClick={() => onBack(id)}
            className="h-9 w-9 inline-flex items-center justify-center rounded-xl bg-white text-black border border-white hover:bg-white/90 transition-colors"
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
              ? "bg-white text-black border-white hover:bg-white/90"
              : "bg-white/6 text-white/40 border-white/10 pointer-events-none",
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
            aria-label="Next"
            title="Next"
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
  onBudgetMinChange,
  onBudgetMaxChange,
  onBudgetUnitChange,
  expMin,
  expMax,
  onExpMinChange,
  onExpMaxChange,
  startWithin,
  onStartWithinChange,
  platform,
  onPlatformChange,
  identity,
  identityLoading,
  identityError,
  identityOptions,
  identityPickerOpen,
  onIdentitySelect,
  onIdentityConnect,
  onIdentityChange,
  onIdentityPickerClose,
  styles,
  onStylesChange,
  turnaround,
  onTurnaroundChange,
  tools,
  toolInput,
  onToolInputChange,
  onAddTool,
  onRemoveTool,
  about,
  responsibilities,
  requirements,
  howToApply,
  onAboutChange,
  onResponsibilitiesChange,
  onRequirementsChange,
  onHowToApplyChange,
  tagInput,
  tags,
  onTagInputChange,
  onAddTag,
  onRemoveTag,
  refTitle,
  refUrl,
  refUrlError,
  refVideos,
  onRefTitleChange,
  onRefUrlChange,
  onAddRefVideo,
  onRemoveRefVideo,
  onSubmit,
  onSaveBasics,
  onSaveContent,
  onSaveTags,
  onSaveReferenceVideos,
  canSaveBasics,
  canSaveContent,
  canSaveTags,
  canSaveReferenceVideos,
  submitError,
  isSubmitting,
  publishDisabled = false,
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
    Record<"title" | "city" | "cityInvalid" | "budgetRange" | "identity" | "platform", string>
  >;
  contentErrors?: Partial<Record<"about", string>>;
  title: string;
  onTitleChange: (next: string) => void;
  workMode: "Remote" | "Hybrid" | "On-site";
  onWorkModeChange: (next: "Remote" | "Hybrid" | "On-site") => void;
  city: string;
  onCityChange: (next: string) => void;
  budgetMin: string;
  budgetMax: string;
  budgetUnit: "per project" | "per month";
  onBudgetMinChange: (next: string) => void;
  onBudgetMaxChange: (next: string) => void;
  onBudgetUnitChange: (next: "per project" | "per month") => void;
  expMin: string;
  expMax: string;
  onExpMinChange: (next: string) => void;
  onExpMaxChange: (next: string) => void;
  startWithin: StartTimeframe | "";
  onStartWithinChange: (next: StartTimeframe | "") => void;
  platform: "youtube" | "instagram";
  onPlatformChange: (platform: "youtube" | "instagram") => void;
  identity: VerifiedIdentity | null;
  identityLoading: boolean;
  identityError: string | null;
  identityOptions: VerifiedIdentity[];
  identityPickerOpen: boolean;
  onIdentitySelect: (brandId: string) => void;
  onIdentityConnect: () => void;
  onIdentityChange: () => void;
  onIdentityPickerClose: () => void;
  styles: string[];
  onStylesChange: (next: string[]) => void;
  turnaround: Turnaround;
  onTurnaroundChange: (next: Turnaround) => void;
  tools: string[];
  toolInput: string;
  onToolInputChange: (next: string) => void;
  onAddTool: (tool: string) => void;
  onRemoveTool: (tool: string) => void;
  about: string;
  responsibilities: string;
  requirements: string;
  howToApply: string;
  onAboutChange: (next: string) => void;
  onResponsibilitiesChange: (next: string) => void;
  onRequirementsChange: (next: string) => void;
  onHowToApplyChange: (next: string) => void;
  tagInput: string;
  tags: string[];
  onTagInputChange: (next: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
  refTitle: string;
  refUrl: string;
  refUrlError?: string;
  refVideos: { title?: string; url: string }[];
  onRefTitleChange: (next: string) => void;
  onRefUrlChange: (next: string) => void;
  onAddRefVideo: () => void;
  onRemoveRefVideo: (idx: number) => void;
  onSubmit: (e: React.FormEvent) => void;
  onSaveBasics: () => boolean | void;
  onSaveContent?: () => boolean | void;
  onSaveTags?: () => boolean | void;
  onSaveReferenceVideos?: () => boolean | void;
  canSaveBasics: boolean;
  canSaveContent: boolean;
  canSaveTags: boolean;
  canSaveReferenceVideos: boolean;
  submitError?: string | null;
  isSubmitting?: boolean;
  publishDisabled?: boolean;
}) {
  const [savedSection, setSavedSection] = useState<null | "basics" | "content" | "tags" | "refs">(null);
  const toastTimerRef = useRef<number | null>(null);
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

  const toolGhost = ghostMatch(toolInput, TOOL_SUGGESTIONS.filter((t) => !tools.includes(t)));
  const toolRemainder = ghostRemainder(toolInput, toolGhost);
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
    if (id === "basics") {
      const titleError = basicsErrors?.title;
      const identityErrorMessage = basicsErrors?.identity;
      const cityError = basicsErrors?.city || basicsErrors?.cityInvalid;
      const budgetError = basicsErrors?.budgetRange;
      const platformError = basicsErrors?.platform;
      const invalidClass =
        "border-amber-200/40 ring-1 ring-amber-200/25 focus:border-amber-200/50";
      return (
        <StepCard
          title="BASICS"
          bodyClassName="mt-4"
          size="tall"
          actions={
            <StepActions
              id="basics"
              canSave={canSaveBasics}
              onSave={onSaveBasics}
              canGoBack={false}
              canGoNext={hasNext}
              onBack={onBack}
              onNext={onNext}
              isBusy={isSubmitting}
              savedSection={savedSection}
              onSaveClick={handleSave}
            />
          }
        >
          <div className="grid gap-4">
            <Field
              label={
                <span className="inline-flex items-center gap-1">
                  Job title <span className="text-white/50">*</span>
                </span>
              }
              error={titleError}
            >
              <div className="space-y-2">
                <input
                  className={[inputBase, "uppercase", titleError ? invalidClass : ""].join(" ")}
                  placeholder="e.g. Video editor for YouTube (retention-focused)"
                  value={title}
                  maxLength={JOB_TITLE_MAX_LENGTH}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next.length <= JOB_TITLE_MAX_LENGTH) onTitleChange(next);
                  }}
                />
                <div className="flex items-center justify-end">
                  <div className="text-[11px] text-white/45 tabular-nums">
                    {title.length}/{JOB_TITLE_MAX_LENGTH}
                  </div>
                </div>
              </div>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Location" optional>
                <select
                  className={selectBase}
                  value={workMode}
                  onChange={(e) => {
                    const next = e.target.value as "Remote" | "Hybrid" | "On-site";
                    onWorkModeChange(next);
                    if (next === "Remote") onCityChange("");
                  }}
                >
                  {(["Remote", "Hybrid", "On-site"] as const).map((m) => (
                    <option key={m} value={m} className="bg-[#0b0b0f]">
                      {m}
                    </option>
                  ))}
                </select>
              </Field>

              {workMode === "Hybrid" || workMode === "On-site" ? (
                <Field
                  label={
                    <span className="inline-flex items-center gap-1">
                      City <span className="text-white/50">*</span>
                    </span>
                  }
                  optional
                  error={cityError}
                >
                  <div className="relative">
                    <input
                      className={[inputBase, cityError ? invalidClass : ""].join(" ")}
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

            <Field label="Budget" optional error={budgetError}>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto] items-center">
                <input
                  className={[inputBase, budgetError ? invalidClass : ""].join(" ")}
                  placeholder="Min"
                  inputMode="numeric"
                  value={budgetMin}
                  onChange={(e) => onBudgetMinChange(onlyDigits(e.target.value))}
                />

                <span className="text-white/45 select-none">–</span>

                <input
                  className={[inputBase, budgetError ? invalidClass : ""].join(" ")}
                  placeholder="Max"
                  inputMode="numeric"
                  value={budgetMax}
                  onChange={(e) => onBudgetMaxChange(onlyDigits(e.target.value))}
                />

                <select
                  className={selectBase}
                  value={budgetUnit}
                  onChange={(e) => onBudgetUnitChange(e.target.value as "per project" | "per month")}
                >
                  {(["per project", "per month"] as const).map((u) => (
                    <option key={u} value={u} className="bg-[#0b0b0f]">
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </Field>

            <Field label="Experience" optional>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] items-center">
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

            <Field
              label={
                <span className="inline-flex items-center gap-1">
                  Platform <span className="text-white/50">*</span>
                </span>
              }
              error={platformError}
            >
              <div className="flex flex-wrap gap-2">
                {PLATFORM_SUGGESTIONS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={pill(p.toLowerCase() === platform)}
                    onClick={() => onPlatformChange(p.toLowerCase() as "youtube" | "instagram")}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </Field>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-white/80 inline-flex items-center gap-1">
                    Verify your content creator account <span className="text-white/40">(optional)</span>
                  </div>
                {identityErrorMessage ? (
                  <div className="inline-flex items-center gap-1 text-[11px] text-amber-200/90">
                    <Icon name="alert" className="w-3 h-3" />
                    <span>{identityErrorMessage}</span>
                  </div>
                ) : null}
              </div>

              {!identity ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <div className="text-sm font-semibold text-white/90 inline-flex items-center gap-1">
                    Verify your content creator account <span className="text-white/40">(optional)</span>
                  </div>
                  <div className="mt-1 text-[11px] text-white/50">
                    Add verification when you want a trusted channel/page badge on the job.
                  </div>
                  {identityError ? (
                    <div className="mt-2 text-[11px] text-amber-200/90">{identityError}</div>
                  ) : null}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      onIdentityConnect();
                    }}
                    disabled={identityLoading}
                    className={[
                      "mt-3 h-10 px-4 rounded-xl",
                      "bg-white text-black font-semibold text-sm",
                      "shadow-[0_14px_35px_-26px_rgba(0,0,0,0.95)]",
                      "transition-transform duration-150 hover:-translate-y-[1px] hover:bg-white/95",
                      identityLoading ? "opacity-70 pointer-events-none" : "",
                    ].join(" ")}
                  >
                    {identityLoading
                      ? "Connecting..."
                      : platform === "youtube"
                        ? "Connect YouTube"
                        : "Connect Instagram"}
                  </button>
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-full border border-white/15 bg-white/10 overflow-hidden flex items-center justify-center flex-shrink-0">
                        {identity.imageUrl ? (
                          <img src={identity.imageUrl} alt={identity.name} className="h-full w-full object-cover" />
                        ) : (
                          <Icon name={platform === "youtube" ? "youtube" : "instagram"} className="w-5 h-5 text-white/70" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="text-sm font-semibold text-white/90 truncate">{identity.name}</div>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/10 border border-white/10 text-white/80">
                            Verified
                          </span>
                        </div>
                        <div className="text-xs text-white/55 truncate">
                          {identity.handle ? `${identity.handle} • ` : ""}
                          {identity.followersCount != null
                            ? `${formatCompactNumber(identity.followersCount)} ${
                                platform === "youtube" ? "subscribers" : "followers"
                              }`
                            : platform === "youtube"
                              ? "Subscribers hidden"
                              : "Followers hidden"}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={onIdentityChange}
                      className="h-9 px-3 rounded-xl bg-white/7 border border-white/12 text-white/80 text-sm font-semibold hover:bg-white/10 hover:text-white transition-colors"
                    >
                      Refresh
                    </button>
                  </div>

                  {platform === "youtube" && identityOptions.length > 0 ? (
                    <div className="mt-3">
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">
                        Posting as
                      </label>
                      <select
                        className={selectBase}
                        value={identity.brandId}
                        onChange={(event) => onIdentitySelect(event.target.value)}
                        disabled={identityLoading}
                      >
                        {identityOptions.map((option) => (
                          <option key={option.brandId} value={option.brandId} className="bg-[#0b0b0f]">
                            {option.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {identityPickerOpen ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
                <div className="w-full max-w-md rounded-2xl bg-[#111216] border border-white/10 p-4">
                  <div className="text-sm font-semibold text-white/90">Select a {platform} account</div>
                  <div className="mt-3 space-y-2 max-h-[260px] overflow-y-auto">
                    {identityOptions.map((option) => (
                      <button
                        key={option.brandId}
                        type="button"
                        onClick={() => onIdentitySelect(option.brandId)}
                        className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 flex items-center gap-3 text-left hover:bg-white/10"
                      >
                        <div className="h-9 w-9 rounded-full border border-white/15 bg-white/10 overflow-hidden flex items-center justify-center flex-shrink-0">
                          {option.imageUrl ? (
                            <img src={option.imageUrl} alt={option.name} className="h-full w-full object-cover" />
                          ) : (
                            <Icon name={platform === "youtube" ? "youtube" : "instagram"} className="w-4 h-4 text-white/70" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white/85 truncate">{option.name}</div>
                          <div className="text-xs text-white/50 truncate">
                            {option.handle ? `${option.handle} • ` : ""}
                            {option.followersCount != null
                              ? `${formatCompactNumber(option.followersCount)} ${
                                  platform === "youtube" ? "subscribers" : "followers"
                                }`
                              : platform === "youtube"
                                ? "Subscribers hidden"
                                : "Followers hidden"}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={onIdentityPickerClose}
                      className="h-9 px-3 rounded-xl bg-white/7 border border-white/12 text-white/80 text-sm font-semibold hover:bg-white/10 hover:text-white transition-colors"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            <Field label="Style" optional helper="Type and press Enter. Tab accepts the ghost suggestion.">
              <StyleSmartInput value={styles} onChange={onStylesChange} className={ghostInputBase} />
            </Field>

            <Field label="Turnaround" optional>
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
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

            <Field label="Tools" optional helper="Select multiple. Tab to complete.">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {tools.map((tool) => (
                    <TinyChip key={tool} onRemove={() => onRemoveTool(tool)}>
                      {tool}
                    </TinyChip>
                  ))}
                </div>
                <div className="relative">
                  <input
                    className={ghostInputBase}
                    placeholder="Type a tool (e.g. Premiere Pro)"
                    value={toolInput}
                    onChange={(e) => onToolInputChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Tab" && toolRemainder) {
                        e.preventDefault();
                        onToolInputChange(toolInput + toolRemainder);
                      }
                      if (e.key === "Enter") {
                        e.preventDefault();
                        onAddTool(toolInput);
                      }
                    }}
                  />
                  <div className="pointer-events-none absolute inset-0 flex items-center px-3 text-sm">
                    {toolInput.length ? (
                      <span className="text-white/90">{toolInput}</span>
                    ) : (
                      <span className="text-white/35">Type a tool (e.g. Premiere Pro)</span>
                    )}
                    {toolRemainder ? <span className="text-white/35">{toolRemainder}</span> : null}
                    {toolRemainder ? (
                      <span className="ml-2 rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/70">
                        Tab
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {TOOL_SUGGESTIONS.slice(0, 6).map((tool) => (
                    <button
                      key={tool}
                      type="button"
                      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10"
                      onClick={() => onAddTool(tool)}
                    >
                      {tool}
                    </button>
                  ))}
                </div>
              </div>
            </Field>

            <Field label="Start" optional>
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
          </div>
          {basicsErrors && Object.keys(basicsErrors).length ? (
            <div className="mt-3 space-y-2">
              {Object.values(basicsErrors).map((message) =>
                message ? (
                  <div
                    key={message}
                    className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-amber-200/90"
                  >
                    <Icon name="alert" className="w-3.5 h-3.5" />
                    <span>{message}</span>
                  </div>
                ) : null
              )}
            </div>
          ) : null}
        </StepCard>
      );
    }

    if (id === "about") {
      const aboutError = contentErrors?.about;
      const platformLower = platform.toLowerCase();
      const aboutTitle =
        platformLower === "youtube"
          ? "About the channel"
          : platformLower === "podcast"
            ? "About the podcast"
            : "About the page";
      const aboutTitleLabel = `${aboutTitle} *`;
      const aboutPlaceholder =
        platformLower === "youtube"
          ? "What kind of videos you make, who they’re for, and what you care about most.\n\nFor example: content theme, posting cadence, tone, and what makes your channel different."
          : platformLower === "podcast"
            ? "What the podcast is about, who listens to it, and how episodes usually flow.\n\nMention the format, frequency, and overall vibe."
            : "Describe your page’s content and audience.\n\nWhat do you usually post, how often, and what style or energy you aim for?";
      return (
        <StepCard
          title={aboutTitleLabel}
          bodyClassName="mt-4"
          size="compact"
          actions={
            <StepActions
              id="about"
              canSave={canSaveContent}
              onSave={onSaveContent}
              canGoBack={hasBack}
              canGoNext={hasNext}
              onBack={onBack}
              onNext={onNext}
              isBusy={isSubmitting}
              savedSection={savedSection}
              onSaveClick={handleSave}
            />
          }
        >
          <div className="grid gap-3">
            <textarea
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
            ) : (
              <div className="text-[11px] text-white/45">
                This helps applicants understand your content and decide if they’re a good fit.
              </div>
            )}
          </div>
        </StepCard>
      );
    }

    if (id === "responsibilities") {
      return (
        <StepCard
          title="Responsibilities"
          bodyClassName="mt-4"
          size="compact"
          optional
          actions={
            <StepActions
              id="responsibilities"
              canSave={canSaveContent}
              onSave={onSaveContent}
              canGoBack={hasBack}
              canGoNext={hasNext}
              onBack={onBack}
              onNext={onNext}
              isBusy={isSubmitting}
              savedSection={savedSection}
              onSaveClick={handleSave}
            />
          }
        >
          <div className="grid gap-3">
            <BulletListEditor
              value={responsibilities}
              onChange={onResponsibilitiesChange}
              ghostLines={[
                "Define deliverables for week 1",
                "Share progress updates",
                "Iterate fast on feedback",
              ]}
            />
          </div>
        </StepCard>
      );
    }

    if (id === "requirements") {
      return (
        <StepCard
          title="Requirements"
          bodyClassName="mt-4"
          size="compact"
          optional
          actions={
            <StepActions
              id="requirements"
              canSave={canSaveContent}
              onSave={onSaveContent}
              canGoBack={hasBack}
              canGoNext={hasNext}
              onBack={onBack}
              onNext={onNext}
              isBusy={isSubmitting}
              savedSection={savedSection}
              onSaveClick={handleSave}
            />
          }
        >
          <div className="grid gap-3">
            <BulletListEditor
              value={requirements}
              onChange={onRequirementsChange}
              ghostLines={["Match tone + pacing", "Strong communication", "Reliable turnaround"]}
            />
            <div className="text-[11px] text-white/45">Must-haves first. Nice-to-haves later.</div>
          </div>
        </StepCard>
      );
    }

    if (id === "howToApply") {
      return (
        <StepCard
          title="How to apply"
          bodyClassName="mt-4"
          size="compact"
          optional
          actions={
            <StepActions
              id="howToApply"
              canSave={canSaveContent}
              onSave={onSaveContent}
              canGoBack={hasBack}
              canGoNext={hasNext}
              onBack={onBack}
              onNext={onNext}
              isBusy={isSubmitting}
              savedSection={savedSection}
              onSaveClick={handleSave}
            />
          }
        >
          <div className="grid gap-3">
            <textarea
              className={textareaBase}
              placeholder={`Include:\n- 2–3 line intro + relevant experience\n- 2 examples of similar work (describe briefly)\n- Tools you use + availability/timezone\n- Expected turnaround + your questions (if any)`}
              value={howToApply}
              onChange={(e) => {
                onHowToApplyChange(e.target.value);
              }}
            />
          </div>
        </StepCard>
      );
    }

    if (id === "referenceVideos") {
      return (
        <StepCard
          title="Reference videos"
          bodyClassName="mt-4"
          size="compact"
          optional
          actions={
            <StepActions
              id="referenceVideos"
              canSave={canSaveReferenceVideos}
              onSave={onSaveReferenceVideos}
              canGoBack={hasBack}
              canGoNext={hasNext}
              onBack={onBack}
              onNext={onNext}
              isBusy={isSubmitting}
              savedSection={savedSection}
              onSaveClick={handleSave}
            />
          }
        >
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] items-end">
              <Field label="Video title" optional>
                <input
                  className={inputBase}
                  placeholder="e.g. Pacing + retention reference"
                  value={refTitle}
                  onChange={(e) => onRefTitleChange(e.target.value)}
                />
              </Field>

              <Field label="YouTube video URL" optional error={refUrlError}>
                <input
                  className={inputBase}
                  type="url"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={refUrl}
                  onChange={(e) => onRefUrlChange(e.target.value)}
                />
              </Field>

              <button
                type="button"
                className={[
                  "h-11 px-4 rounded-xl",
                  "bg-white text-black font-semibold text-sm",
                  "shadow-[0_14px_35px_-26px_rgba(0,0,0,0.95)]",
                  "transition-transform duration-150 hover:-translate-y-[1px] hover:bg-white/95",
                ].join(" ")}
                onClick={onAddRefVideo}
              >
                Add
              </button>
            </div>

            <div className="space-y-2">
              {refVideos.length ? (
                refVideos.map((v, idx) => (
                  <div
                    key={`${v.url}-${idx}`}
                    className="rounded-2xl bg-white/4 border border-white/10 px-4 py-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white/85 truncate">
                        {v.title || `Reference video ${idx + 1}`}
                      </div>
                      <div className="text-xs text-white/45 truncate">{v.url}</div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <a
                        href={v.url}
                        target="_blank"
                        rel="noreferrer"
                        className="h-9 px-3 rounded-xl bg-white/7 border border-white/12 text-white/80 text-sm font-semibold hover:bg-white/10 hover:text-white transition-colors inline-flex items-center gap-2"
                      >
                        <Icon name="youtube" className="w-4 h-4" />
                        Open
                      </a>

                      <button
                        type="button"
                        onClick={() => onRemoveRefVideo(idx)}
                        className="h-9 w-9 rounded-xl bg-white/6 border border-white/10 hover:bg-white/10 transition-colors inline-flex items-center justify-center text-white/70"
                        aria-label="Remove"
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-xs text-white/45">
                  Add 1–3 reference videos so applicants know the exact style to match.
                </div>
              )}
            </div>
          </div>
        </StepCard>
      );
    }

    return (
      <StepCard
        title="Tags"
        bodyClassName="mt-4"
        size="compact"
        optional
        actions={
            <StepActions
              id="tags"
              canSave={canSaveTags}
              onSave={onSaveTags}
              canGoBack={hasBack}
              canGoNext
              onBack={onBack}
              onNext={onNext}
              nextType="submit"
              nextIcon={isSubmitting ? undefined : <Icon name="globe" className="w-4 h-4" />}
              nextLabel={isSubmitting ? "POSTING..." : "POST JOB"}
              nextDisabled={publishDisabled}
              isBusy={isSubmitting}
              savedSection={savedSection}
              onSaveClick={handleSave}
            />
        }
      >
        <div className="grid gap-3">
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
      </StepCard>
    );
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-white/[0.06] border border-white/10 p-6 sm:p-7 shadow-[0_18px_60px_-40px_rgba(0,0,0,0.95)]">
        <div className="grid items-start">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-[1.05]">POST A JOB</h1>
          <div>
            <p className="mt-4 text-sm text-white/55">{STEP_SUBTITLES[step]}</p>
            <div className="mt-2">
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
