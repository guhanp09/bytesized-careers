"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  completeLaunchFreeCheckout,
  createTalentListing,
  listMyTalentListings,
  listMyPortfolio,
  updateTalentListing,
} from "../lib/backendClient";
import type { BackendPortfolioItem, BackendTalentListing } from "../lib/backendClient";
import { formatListingTitle } from "../lib/displayText";
import {
  TALENT_EXPERIENCE_MAX_YEARS,
  TALENT_EXPERIENCE_MIN_YEARS,
  TALENT_LISTING_DEFAULT_AVAILABILITY,
  formatTalentExperienceYears,
  talentExperienceYears,
} from "../lib/talentListing";
import {
  CONTENT_GENRE_SUGGESTIONS,
  CONTENT_NICHE_SUGGESTIONS,
  CREATOR_CONTEXT_MAX_ITEMS,
  FORMATS_HIRED_FOR_SUGGESTIONS,
  normalizeCreatorContextList,
  normalizeCreatorContextValue,
} from "../lib/jobCreatorContext";
import { getTalentDraftCompletion } from "../lib/draftCompletion";
import {
  CUSTOM_INSTRUCTION_REQUIREMENT_KEY,
  sanitizeRequirementKeys,
} from "../lib/firstMessageRequirements";
import { Icon } from "./Icons";
import { MetaRow, PageLoading, StatRow, TagPill } from "./ui";
import RecommendedChecklistPopup, { RecommendedChecklistItem } from "./RecommendedChecklistPopup";
import RequirementSelector from "./first-message/RequirementSelector";
import ToolPicker from "./you/ToolPicker";
import LanguagePicker from "./post-flow/LanguagePicker";

type Step = "basics" | "details" | "services" | "creatorContext" | "toolsPortfolio" | "hiringRequests";
type AvailabilityStatus = "available" | "selective" | "unavailable";
type RateIntent = "" | "contact" | "flexible";
type TalentWorkMode = "" | "Remote" | "Hybrid" | "On-site";
type TalentFieldKey = "title" | "primaryRole" | "location" | "workMode" | "rateChoice" | "rateRange";
type TalentFieldErrors = Partial<Record<TalentFieldKey, string>>;
type IconName = React.ComponentProps<typeof Icon>["name"];

type TalentQualityItem = RecommendedChecklistItem<Step>;

const TALENT_COMPLETION_TARGETS: Record<string, { step: Step; target?: string }> = {
  basics: { step: "basics" },
  collaboration: { step: "basics" },
  rate: { step: "basics" },
  workMode: { step: "basics" },
  preview: { step: "hiringRequests" },
  portfolio: { step: "toolsPortfolio", target: "talent-portfolio" },
  tools: { step: "toolsPortfolio", target: "talent-tools" },
  niche: { step: "creatorContext", target: "talent-platforms" },
  creatorContext: { step: "creatorContext", target: "talent-creator-context" },
  platforms: { step: "creatorContext", target: "talent-platforms" },
  description: { step: "services", target: "talent-services" },
  experience: { step: "basics", target: "talent-experience" },
  "talent-first-message": { step: "hiringRequests", target: "talent-first-message" },
};

const normalizeTalentWorkMode = (value?: string | null): TalentWorkMode => {
  const normalized = (value || "").toLowerCase();
  if (normalized.includes("hybrid")) return "Hybrid";
  if (normalized.includes("onsite") || normalized.includes("on-site")) return "On-site";
  if (normalized.includes("remote")) return "Remote";
  return "";
};

// Step labels stay internal (routing, progress, and accessibility only) — they are
// intentionally not rendered as visible pills/labels in the progress header.
const STEPS: Array<{ id: Step; label: string }> = [
  { id: "basics", label: "Basics" },
  { id: "details", label: "Details" },
  { id: "services", label: "Services" },
  { id: "creatorContext", label: "Creator context" },
  { id: "toolsPortfolio", label: "Tools & portfolio" },
  { id: "hiringRequests", label: "Hiring requests" },
];

// Short, calm, motivating microcopy — mirrors the Post a Job header tone and keeps
// the flow feeling light. One line per step; this is the only contextual copy shown.
const STEP_MICROCOPY: Record<Step, string> = {
  basics: "Start with the essentials.",
  details: "Set practical expectations.",
  services: "Describe what you offer.",
  creatorContext: "Shape your creator fit.",
  toolsPortfolio: "Show how you work.",
  hiringRequests: "Set hiring request details.",
};

const LEGACY_STEP_MAP: Record<string, Step> = {
  basics: "basics",
  focus: "creatorContext",
  collaboration: "basics",
  proof: "toolsPortfolio",
  preview: "hiringRequests",
  publish: "hiringRequests",
};

const inputBase =
  "h-11 w-full rounded-xl border border-white/10 bg-white/[0.055] px-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-white/25 focus:bg-white/[0.07]";
const selectBase =
  "h-11 w-full cursor-pointer rounded-xl border border-white/10 bg-white/[0.055] px-3 text-sm text-white outline-none transition-colors focus:border-white/25 focus:bg-white/[0.07]";
const choiceButton = (active: boolean) =>
  [
    "h-10 cursor-pointer rounded-xl border px-3 text-sm font-semibold transition-colors",
    active
      ? "border-white bg-white text-black"
      : "border-white/10 bg-white/[0.045] text-white/64 hover:border-white/18 hover:bg-white/[0.07] hover:text-white",
  ].join(" ");
const footerSecondaryButton =
  "inline-flex h-10 min-w-[116px] cursor-pointer items-center justify-center rounded-xl border border-white/[0.16] bg-white/[0.065] px-4 text-sm font-semibold text-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-[background-color,border-color,color,transform] hover:border-white/25 hover:bg-white/[0.095] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101014] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55";
const footerIconButton =
  "inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-white bg-white text-black transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101014] active:translate-y-px disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/15 disabled:text-white/36 disabled:opacity-100";
const footerDisabledIconButton =
  "inline-flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-xl border border-white/10 bg-white/15 text-white/36";

const parseList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const cleanServiceLine = (value: string) => value.replace(/^\s*[-•]\s*/, "").replace(/\s+/g, " ").trim();

const parseServicesValue = (value: string) => {
  const rawLines = value
    .split(/\n+/)
    .map(cleanServiceLine)
    .filter(Boolean);
  const lines = rawLines.length ? rawLines : value.trim() ? [cleanServiceLine(value)] : [];
  return uniq(lines).slice(0, 12);
};

const splitLegacyContext = (value?: string | null) =>
  normalizeCreatorContextList(
    (value || "")
      .split(/[·,]/)
      .map((item) => item.trim())
      .filter(Boolean)
  );

const parseMoney = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : NaN;
};

const formatInr = (amount: string) => {
  const parsed = Number(amount);
  return Number.isFinite(parsed) ? `₹${new Intl.NumberFormat("en-IN").format(parsed)}` : amount;
};

const initials = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

const uniq = (values: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

function PreviewTagRow({ tags }: { tags: string[] }) {
  const firstThreeLength = tags.slice(0, 3).join("").length;
  const visibleCount = tags.length > 2 && firstThreeLength > 28 ? 2 : 3;
  const visible = tags.slice(0, visibleCount);
  const extra = tags.length - visible.length;

  return (
    <div className="flex min-w-0 flex-nowrap gap-1.5 overflow-hidden">
      {visible.map((tag) => (
        <TagPill key={tag} className="shrink-0 whitespace-nowrap">
          {tag}
        </TagPill>
      ))}
      {extra > 0 ? (
        <span className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/55">
          +{extra}
        </span>
      ) : null}
    </div>
  );
}

function ContextTinyChip({
  children,
  onRemove,
}: {
  children: React.ReactNode;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/8 px-2 py-1 text-[11px] text-white/80">
      {children}
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white"
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
  targetId,
  value,
  suggestions,
  onChange,
}: {
  label: string;
  helper: string;
  icon: IconName;
  targetId?: string;
  value: string[];
  suggestions: readonly string[];
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
            <ContextTinyChip key={item} onRemove={() => removeValue(item)}>
              {item}
            </ContextTinyChip>
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

function ServicesBulletEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  type Row = { id: string; value: string };
  const makeRowIdRef = useRef(0);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const focusRowIdRef = useRef<string | null>(null);
  const emittedSignatureRef = useRef<string | null>(null);

  const makeRow = (rowValue = ""): Row => {
    makeRowIdRef.current += 1;
    return { id: `service-row-${makeRowIdRef.current}`, value: rowValue };
  };

  const rowsFromValue = (nextValue: string) => {
    const parsed = parseServicesValue(nextValue);
    return parsed.length ? parsed.map((item) => makeRow(item)) : [makeRow()];
  };

  const [rows, setRows] = useState<Row[]>(() => rowsFromValue(value));

  useEffect(() => {
    const signature = parseServicesValue(value).join("\n");
    if (signature === emittedSignatureRef.current) return;
    setRows(rowsFromValue(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (!focusRowIdRef.current) return;
    inputRefs.current[focusRowIdRef.current]?.focus();
    focusRowIdRef.current = null;
  }, [rows.length]);

  const emitRows = (nextRows: Row[]) => {
    const cleaned = uniq(nextRows.map((row) => cleanServiceLine(row.value)).filter(Boolean));
    const nextValue = cleaned.join("\n");
    emittedSignatureRef.current = nextValue;
    onChange(nextValue);
  };

  const updateRows = (updater: (current: Row[]) => Row[]) => {
    setRows((current) => {
      const nextRows = updater(current);
      emitRows(nextRows);
      return nextRows;
    });
  };

  const addRow = () => {
    const nextRow = makeRow();
    focusRowIdRef.current = nextRow.id;
    updateRows((current) => [...current, nextRow]);
  };

  const updateRow = (id: string, rowValue: string) => {
    updateRows((current) => current.map((row) => (row.id === id ? { ...row, value: rowValue } : row)));
  };

  const removeRow = (id: string) => {
    updateRows((current) => {
      const nextRows = current.filter((row) => row.id !== id);
      return nextRows.length ? nextRows : [makeRow()];
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={row.id} className="flex items-center gap-2">
            <span className="flex h-11 w-5 shrink-0 items-center justify-center text-lg leading-none text-white/58" aria-hidden="true">
              •
            </span>
            <input
              ref={(node) => {
                inputRefs.current[row.id] = node;
              }}
              className={inputBase}
              value={row.value}
              placeholder={
                index === 0
                  ? "e.g. Shorts video editing"
                  : index === 1
                    ? "e.g. Thumbnail design for finance channels"
                    : "e.g. Long-form YouTube editing"
              }
              onChange={(event) => updateRow(row.id, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addRow();
                }
              }}
              aria-label={`Service offered ${index + 1}`}
            />
            <button
              type="button"
              onClick={() => removeRow(row.id)}
              className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/48 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/15"
              aria-label={`Remove service ${index + 1}`}
              title="Remove"
            >
              <Icon name="x" className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addRow}
        className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg px-1 text-sm font-semibold text-white/50 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/15"
      >
        <Icon name="plus" className="h-4 w-4" />
        Add service
      </button>
    </div>
  );
}

function PreviewListingCta({ label }: { label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-sm px-0.5 py-0.5 text-[12px] font-extrabold tracking-[0.04em] text-white/90">
      <span>{label}</span>
      <span aria-hidden="true">→</span>
    </span>
  );
}

function Field({
  label,
  children,
  wide,
  required,
  error,
  targetId,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
  required?: boolean;
  error?: string;
  targetId?: string;
}) {
  return (
    <label
      className={["space-y-1.5", wide ? "sm:col-span-2" : ""].join(" ")}
      data-quality-target={targetId}
    >
      <span className="flex items-center justify-between gap-3 text-xs font-medium text-white/55">
        <span>
          {label}
          {required ? <span className="text-white/50"> *</span> : null}
        </span>
        {error ? (
          <span className="inline-flex items-center gap-1 text-amber-100/78">
            <Icon name="alert" className="h-3 w-3" />
            {error}
          </span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

function LabelWithIcon({
  icon,
  children,
}: {
  icon: IconName;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <Icon name={icon} className="h-3.5 w-3.5 shrink-0 text-white/45" />
      <span>{children}</span>
    </span>
  );
}

function StepShell({
  title,
  icon,
  children,
  footer,
}: {
  title: string;
  icon: IconName;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.055] p-5 shadow-[0_18px_60px_-40px_rgba(0,0,0,0.95)] sm:p-6">
      <div className="mb-5 flex items-center gap-2">
        <Icon name={icon} className="h-5 w-5 shrink-0 text-white/55" />
        <h2 className="text-sm font-semibold uppercase tracking-tight text-white/90">{title}</h2>
      </div>
      {children}
      {footer ? <div className="mt-6 border-t border-white/[0.08] pt-4">{footer}</div> : null}
    </section>
  );
}

function TalentListingProgressHeader({
  title,
  microcopy,
  stepNumber,
  totalSteps,
  stepLabel,
  progress,
}: {
  title: string;
  microcopy: string;
  stepNumber: number;
  totalSteps: number;
  stepLabel: string;
  progress: number;
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.06] p-6 shadow-[0_18px_60px_-40px_rgba(0,0,0,0.95)] sm:p-7">
      <div className="grid items-start">
        <h1 className="text-2xl font-extrabold tracking-tight leading-[1.05] sm:text-3xl">{title}</h1>
        <div>
          <p className="mt-4 text-sm text-white/55">{microcopy}</p>
          {/* Visually hidden but announced: keeps step position available to screen readers. */}
          <p className="sr-only">{`Step ${stepNumber} of ${totalSteps}: ${stepLabel}`}</p>
          <div className="mt-2">
            <div
              className="h-[3px] overflow-hidden rounded-full bg-white/10"
              role="progressbar"
              aria-label="Talent listing progress"
              aria-valuemin={1}
              aria-valuemax={totalSteps}
              aria-valuenow={stepNumber}
              aria-valuetext={`Step ${stepNumber} of ${totalSteps}: ${stepLabel}`}
            >
              <div
                className="h-full rounded-full bg-white/45 transition-[width] duration-300 ease-out"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TalentPreview({
  title,
  primaryRole,
  experience,
  location,
  timezone,
  workMode,
  niche,
  contentNiches,
  contentGenres,
  formats,
  platforms,
  tools,
  rateNote,
  rateMin,
  rateMax,
  rateCurrency,
}: {
  title: string;
  primaryRole: string;
  experience: string;
  location: string;
  timezone: string;
  workMode: string;
  niche: string;
  contentNiches: string[];
  contentGenres: string[];
  formats: string[];
  platforms: string[];
  tools: string[];
  rateNote: string;
  rateMin: string;
  rateMax: string;
  rateCurrency: string;
}) {
  const role = primaryRole.trim() || "Content talent";
  const showTitle = formatListingTitle(title.trim() || "Your talent listing headline");
  const meta = [role, location.trim() || "Remote", timezone.trim()].filter(Boolean).join(" · ");
  const min = rateMin.trim();
  const max = rateMax.trim();
  const currency = rateCurrency.trim().toUpperCase() || "INR";
  const rate =
    rateNote.trim() ||
    (min && max
      ? currency === "INR"
        ? `${formatInr(min)}-${formatInr(max)}`
        : `${currency} ${min}-${max}`
      : min
        ? currency === "INR"
          ? `${formatInr(min)}+`
          : `${currency} ${min}+`
        : "Rate not set");
  const experienceValue = experience.trim() || "Not specified";
  const modeOrLocation = titleCase(workMode || "Remote");
  const tags = uniq([...formats, ...contentNiches, ...contentGenres, ...tools, ...platforms, niche]);

  return (
    <article className="group relative isolate flex h-[340px] min-w-0 flex-col rounded-2xl border border-white/10 bg-white/[0.06] p-5 shadow-[0_10px_30px_-20px_rgba(0,0,0,0.9)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-xs font-bold text-white/70">
            {initials(role) || <Icon name="user" className="h-4 w-4" />}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white/88">{role}</p>
            <p className="mt-1 truncate text-xs text-white/55">{meta}</p>
          </div>
        </div>
        <PreviewListingCta label="Hire Me" />
      </div>

      <h3 className="mt-4 h-[52px] line-clamp-2 text-[15px] font-extrabold leading-snug text-white">
        {showTitle}
      </h3>

      <div className="mt-4 space-y-2">
        <MetaRow icon="cash-stack" text={rate} />
        <MetaRow icon="cap" text={`Experience: ${experienceValue}`} />
        <MetaRow icon="pin" text={modeOrLocation} />
      </div>

      {tags.length ? (
        <div className="mt-4 overflow-hidden">
          <PreviewTagRow tags={tags} />
        </div>
      ) : null}

      <div className="mt-auto flex h-10 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4 overflow-hidden">
          <StatRow icon="eye" value="0" label="Currently viewing" interactive className="shrink-0" />
          <StatRow icon="user-plus" value="0" label="Interested recruiters" interactive className="shrink-0" />
          <StatRow icon="bolt" value="0%" label="Response rate" interactive className="shrink-0" />
        </div>
        <div className="flex flex-shrink-0 items-center gap-2" aria-hidden="true">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/6 text-white/72">
            <Icon name="bookmark" className="h-4 w-4" />
          </span>
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/6 text-white/72">
            <Icon name="share" className="h-4 w-4" />
          </span>
        </div>
      </div>
    </article>
  );
}

function TalentPublishReadyDialog({
  open,
  missing,
  onAddDetails,
  onPublishAnyway,
  onClose,
  publishButtonRef,
}: {
  open: boolean;
  missing: TalentQualityItem[];
  onAddDetails: () => void;
  onPublishAnyway: () => void;
  onClose: () => void;
  publishButtonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  if (!open) return null;

  return (
    <div className="ui-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/72 px-4 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="talent-publish-ready-title"
        className="ui-modal-panel w-full max-w-[520px] rounded-[28px] border border-white/[0.1] bg-[#101014] p-6 shadow-[0_34px_90px_-36px_rgba(0,0,0,1)]"
      >
        <h2 id="talent-publish-ready-title" className="text-xl font-semibold tracking-tight text-white">
          Your listing is ready to publish
        </h2>
        <p className="mt-3 text-sm leading-6 text-white/62">
          A few extra details could make the listing stronger. You can add them now, or publish and update it later.
        </p>
        {missing.length ? (
          <ul className="mt-4 space-y-2 text-sm text-white/58">
            {missing.slice(0, 4).map((item) => (
              <li key={item.id} className="flex items-center gap-2">
                <Icon name="plus" className="h-3.5 w-3.5 text-white/35" />
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 cursor-pointer rounded-xl px-4 text-sm font-semibold text-white/58 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onAddDetails}
            className="h-10 cursor-pointer rounded-xl border border-white/12 px-4 text-sm font-semibold text-white/76 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            Add details
          </button>
          <button
            ref={publishButtonRef}
            type="button"
            onClick={onPublishAnyway}
            className="h-10 cursor-pointer rounded-xl bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/90"
          >
            Publish anyway
          </button>
        </div>
      </div>
    </div>
  );
}

const titleCase = (value?: string | null) =>
  value
    ? value
        .split(/[_-\s]+/)
        .filter(Boolean)
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(" ")
    : "";

export default function PostTalentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const draftId = searchParams.get("draftId") || "";
  const [step, setStep] = useState<Step>("basics");
  const [title, setTitle] = useState("");
  const [primaryRole, setPrimaryRole] = useState("");
  const [experienceYears, setExperienceYears] = useState("");
  const [roles, setRoles] = useState("");
  const [niche, setNiche] = useState("");
  const [contentNiches, setContentNiches] = useState<string[]>([]);
  const [contentGenres, setContentGenres] = useState<string[]>([]);
  const [formats, setFormats] = useState("");
  const [platforms, setPlatforms] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [timezone, setTimezone] = useState("");
  const [availabilityStatus, setAvailabilityStatus] = useState<AvailabilityStatus>(TALENT_LISTING_DEFAULT_AVAILABILITY);
  const [workMode, setWorkMode] = useState<TalentWorkMode>("");
  const [turnaround, setTurnaround] = useState("");
  const [rateMin, setRateMin] = useState("");
  const [rateMax, setRateMax] = useState("");
  const [rateNote, setRateNote] = useState("");
  const [description, setDescription] = useState("");
  const [portfolioItems, setPortfolioItems] = useState<BackendPortfolioItem[]>([]);
  const [selectedPortfolioIds, setSelectedPortfolioIds] = useState<string[]>([]);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [firstMessageRequirements, setFirstMessageRequirements] = useState<string[]>([]);
  const [firstMessageCustomInstruction, setFirstMessageCustomInstruction] = useState("");
  const [noFirstMessageRequirements, setNoFirstMessageRequirements] = useState(false);
  const [firstMessageError, setFirstMessageError] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<TalentFieldErrors>({});
  const [rateIntent, setRateIntent] = useState<RateIntent>("");
  const [publishReadyOpen, setPublishReadyOpen] = useState(false);
  const [savedStep, setSavedStep] = useState<Step | null>(null);
  const publishAnywayButtonRef = useRef<HTMLButtonElement | null>(null);
  const stepSaveTimerRef = useRef<number | null>(null);

  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const activeStep = STEPS[stepIndex] || STEPS[0];
  const progress = (stepIndex + 1) / STEPS.length;
  const canGoBack = stepIndex > 0;
  const canGoNext = stepIndex < STEPS.length - 1;
  const rolesList = parseList(roles);
  const formatsList = normalizeCreatorContextList(parseList(formats));
  const contentNichesList = normalizeCreatorContextList(contentNiches);
  const contentGenresList = normalizeCreatorContextList(contentGenres);
  const platformsList = parseList(platforms);
  const workSampleItems = portfolioItems.filter((item) => item.is_public && item.publish_status !== "draft");
  const experienceYearsValue = experienceYears.trim() ? Number(experienceYears) : null;
  const experienceDisplay = formatTalentExperienceYears(experienceYearsValue);
  const invalidClass =
    "border-amber-200/40 ring-1 ring-amber-200/25 focus:border-amber-200/50";
  const isTalentLocationRequired = workMode === "Hybrid" || workMode === "On-site";
  const rateNoteIntent = rateNote.trim();
  const explicitRateNote = rateIntent === "contact" ? "Contact for pricing" : rateIntent === "flexible" ? "Flexible" : "";
  const effectiveRateNote = rateNoteIntent || explicitRateNote;

  const rateError = useMemo(() => {
    const min = parseMoney(rateMin);
    const max = parseMoney(rateMax);
    if (Number.isNaN(min) || Number.isNaN(max)) return "Rates must be valid numbers.";
    if ((min ?? 0) < 0 || (max ?? 0) < 0) return "Rates cannot be negative.";
    if (min === null && max !== null) return "Add a minimum rate or use rate guidance.";
    if (min !== null && max !== null && max < min) return "Rate max cannot be lower than rate min.";
    return null;
  }, [rateMin, rateMax]);
  useEffect(() => {
    if (status === "unauthenticated") {
      const next = draftId ? `/post-talent?draftId=${encodeURIComponent(draftId)}` : "/post-talent";
      router.push(`/auth?mode=login&next=${encodeURIComponent(next)}`);
    }
  }, [draftId, router, status]);

  useEffect(() => {
    const token = session?.backendAccessToken;
    if (!token || !draftId) return;
    let mounted = true;
    const hydrate = (listing: BackendTalentListing) => {
      const hydratedYears = talentExperienceYears(listing);
      setTitle(listing.title || "");
      setPrimaryRole(listing.primary_role || "");
      setExperienceYears(hydratedYears != null ? String(hydratedYears) : "");
      setRoles(listing.roles.join(", "));
      const nextContentNiches = normalizeCreatorContextList(
        listing.content_niches?.length ? listing.content_niches : splitLegacyContext(listing.niche)
      );
      const nextContentGenres = normalizeCreatorContextList(listing.content_genres || []);
      const nextFormats = normalizeCreatorContextList(listing.formats || []);
      setNiche(listing.niche || nextContentNiches.join(" · "));
      setContentNiches(nextContentNiches);
      setContentGenres(nextContentGenres);
      setFormats(nextFormats.join(", "));
      setPlatforms(listing.platforms.join(", "));
      setTools(Array.isArray(listing.tools) ? listing.tools : []);
      setLanguages(Array.isArray(listing.languages) ? listing.languages : []);
      setLocation(listing.location || "");
      setTimezone(listing.timezone || "");
      setAvailabilityStatus(listing.availability_status || TALENT_LISTING_DEFAULT_AVAILABILITY);
      setWorkMode(normalizeTalentWorkMode(listing.work_mode));
      setTurnaround(listing.turnaround || "");
      setRateMin(listing.rate_min != null ? String(listing.rate_min) : "");
      setRateMax(listing.rate_max != null ? String(listing.rate_max) : "");
      const nextRateNote = listing.rate_note || "";
      const normalizedRateNote = nextRateNote.trim().toLowerCase();
      setRateNote(nextRateNote);
      setRateIntent(
        normalizedRateNote === "contact for pricing"
          ? "contact"
          : normalizedRateNote === "flexible"
            ? "flexible"
            : ""
      );
      setDescription(listing.description || "");
      setSelectedPortfolioIds(listing.portfolio_item_ids || []);
      // Restore the chosen requirements; the "none" choice is a publish-time
      // gate, so it is re-confirmed intentionally on resume.
      setFirstMessageRequirements(sanitizeRequirementKeys(listing.first_message_requirements, "talent"));
      setFirstMessageCustomInstruction(listing.first_message_custom_instruction || "");
      setNoFirstMessageRequirements(false);
    };
    setDraftLoading(true);
    void listMyTalentListings(token)
      .then((listings) => {
        if (!mounted) return;
        const listing = listings.find((item) => item.id === draftId);
        if (listing) {
          hydrate(listing);
        } else {
          setError("This talent listing draft could not be found.");
        }
      })
      .catch(() => {
        if (mounted) setError("Couldn’t load this talent listing draft.");
      })
      .finally(() => {
        if (mounted) setDraftLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [draftId, session?.backendAccessToken]);

  useEffect(() => {
    const token = session?.backendAccessToken;
    if (!token) return;
    let mounted = true;
    setPortfolioLoading(true);
    void listMyPortfolio(token)
      .then((response) => {
        if (!mounted) return;
        setPortfolioItems(response.items);
      })
      .catch(() => {
        if (!mounted) return;
        setPortfolioItems([]);
      })
      .finally(() => {
        if (!mounted) return;
        setPortfolioLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [session?.backendAccessToken]);

  const talentQualityItems: TalentQualityItem[] = getTalentDraftCompletion({
    title,
    primary_role: primaryRole,
    roles: rolesList,
    work_mode: workMode,
    rate_min: rateMin.trim() ? Number(rateMin) : null,
    rate_max: rateMax.trim() ? Number(rateMax) : null,
    rate_note: effectiveRateNote || null,
    niche,
    content_niches: contentNichesList,
    content_genres: contentGenresList,
    platforms: platformsList,
    formats: formatsList,
    tools,
    portfolio_item_ids: selectedPortfolioIds,
    description,
    experience_years: experienceYearsValue,
  })
    .recommendedItems.map((item) => {
      const target = TALENT_COMPLETION_TARGETS[item.target] || TALENT_COMPLETION_TARGETS[item.jump] || TALENT_COMPLETION_TARGETS.basics;
      return {
        id: item.id,
        label: item.actionLabel,
        complete: item.done,
        step: target.step,
        targetId: target.target,
      };
    });
  const missingTalentQualityItems = talentQualityItems.filter((item) => !item.complete);

  useEffect(() => {
    if (!publishReadyOpen) return;
    window.setTimeout(() => publishAnywayButtonRef.current?.focus(), 0);
  }, [publishReadyOpen]);

  useEffect(() => {
    return () => {
      if (stepSaveTimerRef.current) {
        window.clearTimeout(stepSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (noFirstMessageRequirements || firstMessageRequirements.length) {
      setFirstMessageError(null);
    }
  }, [noFirstMessageRequirements, firstMessageRequirements.length]);

  const focusQualityTarget = (targetId?: string) => {
    if (!targetId) return;
    window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(`[data-quality-target="${targetId}"]`);
      if (!target) return;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
      const focusable = target.matches("input, textarea, select, button, [tabindex]")
        ? target
        : target.querySelector<HTMLElement>("input, textarea, select, button:not([disabled]), [tabindex]:not([tabindex='-1'])");
      window.setTimeout(() => focusable?.focus({ preventScroll: true }), reducedMotion ? 0 : 180);
      if (reducedMotion) return;
      target.animate(
        [
          { boxShadow: "0 0 0 0 rgba(255,255,255,0)", backgroundColor: "rgba(255,255,255,0)" },
          { boxShadow: "0 0 0 1px rgba(255,255,255,0.18)", backgroundColor: "rgba(255,255,255,0.045)" },
          { boxShadow: "0 0 0 0 rgba(255,255,255,0)", backgroundColor: "rgba(255,255,255,0)" },
        ],
        { duration: 1100, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" }
      );
    }, 90);
  };

  const goToTalentQualityItem = (item: TalentQualityItem) => {
    setPublishReadyOpen(false);
    setError(null);
    setStep(item.step);
    focusQualityTarget(item.targetId);
  };

  // Deep-link from the /drafts "Jump to …" links: ?section=<key> opens the right
  // step and focuses the relevant field once the draft has finished hydrating.
  const sectionParam = searchParams.get("section");
  const sectionAppliedRef = useRef(false);
  useEffect(() => {
    if (!sectionParam || sectionAppliedRef.current) return;
    if (draftId && draftLoading) return;
    const legacyStep = LEGACY_STEP_MAP[sectionParam];
    const dest = TALENT_COMPLETION_TARGETS[sectionParam] || (legacyStep ? { step: legacyStep } : null);
    if (!dest) return;
    sectionAppliedRef.current = true;
    setStep(dest.step);
    if (dest.target) focusQualityTarget(dest.target);
  }, [sectionParam, draftId, draftLoading]);

  const clearFieldError = (key: TalentFieldKey) => {
    setError(null);
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const getRequiredErrors = () => {
    const next: TalentFieldErrors = {};
    const hasNumericRateIntent = Boolean(rateMin.trim()) && !rateError;
    const hasExplicitRateIntent = Boolean(effectiveRateNote.trim());

    if (title.trim().length < 3) {
      next.title = title.trim() ? "Use at least 3 characters." : "Add a listing headline.";
    }
    if (primaryRole.trim().length < 2) {
      next.primaryRole = "Add your primary role.";
    }
    if (!workMode.trim()) {
      next.workMode = "Choose how you work.";
    }
    if (isTalentLocationRequired && !location.trim()) {
      next.location = "Add a city for hybrid or on-site work.";
    }
    if (rateError) {
      next.rateRange = rateError;
    } else if (!hasNumericRateIntent && !hasExplicitRateIntent) {
      next.rateChoice = "Add a rate, or choose Contact for pricing/Flexible.";
    }

    return next;
  };

  const applyStepErrors = (keys: TalentFieldKey[], requiredErrors: TalentFieldErrors) => {
    setFieldErrors((current) => {
      const next = { ...current };
      keys.forEach((key) => {
        if (requiredErrors[key]) {
          next[key] = requiredErrors[key];
        } else {
          delete next[key];
        }
      });
      return next;
    });
  };

  // After validation flags fields, pinpoint the problem by scrolling the first
  // invalid field into view and focusing it (the step must render first).
  const focusFirstInvalidField = () => {
    if (typeof window === "undefined") return;
    window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus({ preventScroll: true });
    }, 60);
  };

  const firstErrorStep = (requiredErrors: TalentFieldErrors): Step => {
    if (
      requiredErrors.title ||
      requiredErrors.primaryRole ||
      requiredErrors.location ||
      requiredErrors.workMode ||
      requiredErrors.rateChoice ||
      requiredErrors.rateRange
    ) {
      return "basics";
    }
    return step;
  };

  const validateCurrentStep = () => {
    const requiredErrors = getRequiredErrors();
    if (step === "basics") {
      const keys: TalentFieldKey[] = ["title", "primaryRole", "workMode", "location", "rateChoice", "rateRange"];
      applyStepErrors(keys, requiredErrors);
      const hasErrors = keys.some((key) => Boolean(requiredErrors[key]));
      setError(hasErrors ? "Fix the highlighted fields." : null);
      if (hasErrors) focusFirstInvalidField();
      return !hasErrors;
    }
    setError(null);
    return true;
  };

  const goNext = () => {
    if (!canGoNext || !validateCurrentStep()) return;
    setStep(STEPS[stepIndex + 1].id);
  };

  const goBack = () => {
    if (!canGoBack) return;
    setError(null);
    setStep(STEPS[stepIndex - 1].id);
  };

  const togglePortfolio = (id: string) => {
    setSelectedPortfolioIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  };

  const payload = (publishStatus: "draft" | "published") => ({
    title: publishStatus === "draft" ? title.trim() || "Untitled talent listing" : title.trim(),
    primary_role: primaryRole.trim() || rolesList[0] || null,
    experience_years: experienceYearsValue,
    roles: rolesList,
    niche: niche.trim() || contentNichesList.join(" · ") || null,
    content_niches: contentNichesList,
    content_genres: contentGenresList,
    formats: formatsList,
    platforms: platformsList,
    tools,
    languages,
    work_mode: workMode.trim() || null,
    location: location.trim() || null,
    timezone: timezone.trim() || null,
    availability_status: availabilityStatus || TALENT_LISTING_DEFAULT_AVAILABILITY,
    rate_min: rateMin.trim() ? Number(rateMin) : null,
    rate_max: rateMax.trim() ? Number(rateMax) : null,
    rate_currency: "INR",
    rate_note: effectiveRateNote || null,
    open_slots: null,
    turnaround: turnaround.trim() || null,
    description: description.trim() || null,
    portfolio_item_ids: selectedPortfolioIds,
    first_message_requirements: noFirstMessageRequirements
      ? []
      : sanitizeRequirementKeys(firstMessageRequirements, "talent"),
    first_message_custom_instruction:
      !noFirstMessageRequirements &&
      sanitizeRequirementKeys(firstMessageRequirements, "talent").includes(CUSTOM_INSTRUCTION_REQUIREMENT_KEY)
        ? firstMessageCustomInstruction.trim() || null
        : null,
    status: publishStatus,
  });

  const persistTalentListing = async (publishStatus: "draft" | "published") => {
    const token = session?.backendAccessToken;
    if (!token) {
      const next = draftId ? `/post-talent?draftId=${encodeURIComponent(draftId)}` : "/post-talent";
      router.push(`/auth?mode=login&next=${encodeURIComponent(next)}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (publishStatus === "published") {
        await completeLaunchFreeCheckout(token, {
          kind: "talent_listing",
          target_type: "talent_listing",
          checkout_intent_id: `launch_talent_listing_${Date.now()}`,
        });
      }
      const saved = draftId
        ? await updateTalentListing(token, draftId, payload(publishStatus))
        : await createTalentListing(token, payload(publishStatus));
      const savedId = saved?.id || draftId;
      router.push(
        publishStatus === "draft"
          ? `/drafts?saved=1&type=talent${savedId ? `&draftId=${encodeURIComponent(String(savedId))}` : ""}`
          : "/talent"
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save this talent listing. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (publishStatus: "draft" | "published") => {
    if (publishStatus === "draft") {
      await persistTalentListing("draft");
      return;
    }

    const requiredErrors = getRequiredErrors();
    if (Object.keys(requiredErrors).length) {
      setFieldErrors(requiredErrors);
      setError("Fix the highlighted fields.");
      setStep(firstErrorStep(requiredErrors));
      focusFirstInvalidField();
      return;
    }

    if (!noFirstMessageRequirements && firstMessageRequirements.length === 0) {
      setFirstMessageError(
        "Choose what recruiters must include with their first message, or select “No specific first-message requirements.”"
      );
      setStep("hiringRequests");
      focusQualityTarget("talent-first-message");
      return;
    }
    if (
      !noFirstMessageRequirements &&
      firstMessageRequirements.includes(CUSTOM_INSTRUCTION_REQUIREMENT_KEY) &&
      !firstMessageCustomInstruction.trim()
    ) {
      setFirstMessageError("Add the custom instruction recruiters should answer.");
      setStep("hiringRequests");
      focusQualityTarget("talent-first-message");
      return;
    }

    setFieldErrors({});
    setError(null);
    if (missingTalentQualityItems.length) {
      setPublishReadyOpen(true);
      return;
    }

    await persistTalentListing("published");
  };

  if (status === "loading" || draftLoading) {
    return <PageLoading blocks={4} />;
  }
  const experienceOptions = Array.from(
    { length: TALENT_EXPERIENCE_MAX_YEARS - TALENT_EXPERIENCE_MIN_YEARS + 1 },
    (_, index) => String(TALENT_EXPERIENCE_MIN_YEARS + index)
  );
  const currentStepRequiredErrors = getRequiredErrors();
  const currentStepRequiredKeys: TalentFieldKey[] =
    step === "basics"
      ? ["title", "primaryRole", "workMode", "location", "rateChoice", "rateRange"]
      : [];
  const canConfirmCurrentStep = !currentStepRequiredKeys.some((key) => Boolean(currentStepRequiredErrors[key]));

  const confirmCurrentStep = () => {
    if (!canConfirmCurrentStep || busy) return;
    if (stepSaveTimerRef.current) {
      window.clearTimeout(stepSaveTimerRef.current);
    }
    setSavedStep(step);
    stepSaveTimerRef.current = window.setTimeout(() => setSavedStep(null), 2200);
  };

  const footerActions = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void submit("draft")}
          disabled={busy}
          className={footerSecondaryButton}
        >
          {busy ? "Saving..." : "SAVE DRAFT"}
        </button>
        {canGoBack ? (
          <button
            type="button"
            onClick={goBack}
            disabled={busy}
            className={footerIconButton}
            aria-label="Back"
            title="Back"
          >
            <span className="text-sm leading-none">←</span>
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {savedStep === step ? (
          <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-1 text-xs text-white/90 shadow-[0_12px_30px_-22px_rgba(0,0,0,0.9)] backdrop-blur">
            Saved
          </div>
        ) : null}
        <button
          type="button"
          onClick={confirmCurrentStep}
          disabled={busy || !canConfirmCurrentStep}
          className={canConfirmCurrentStep && !busy ? footerIconButton : footerDisabledIconButton}
          aria-label="Save step"
          title={canConfirmCurrentStep ? "Save step" : undefined}
        >
          <Icon name="check" className="h-4 w-4" />
        </button>
        {canGoNext ? (
          <button
            type="button"
            onClick={goNext}
            disabled={busy}
            className={footerIconButton}
            aria-label="Continue"
            title="Continue"
          >
            <span className="text-sm leading-none">→</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void submit("published")}
            disabled={busy}
            className={footerIconButton}
            aria-label={busy ? "Publishing talent listing" : "Publish talent listing"}
            title={busy ? "Publishing talent listing" : "Publish talent listing"}
          >
            <Icon name="globe" className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );

  const renderStep = () => {
    if (step === "basics") {
      return (
        <StepShell title="Basics" icon="user" footer={footerActions}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={<LabelWithIcon icon="notebook-text">Listing headline</LabelWithIcon>}
              wide
              required
              error={fieldErrors.title}
            >
              <input
                aria-required="true"
                aria-invalid={Boolean(fieldErrors.title)}
                className={[inputBase, fieldErrors.title ? invalidClass : ""].join(" ")}
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  clearFieldError("title");
                }}
                placeholder="Retention-focused video editor for creator-led channels"
              />
            </Field>
            <Field label={<LabelWithIcon icon="briefcase">Primary role</LabelWithIcon>} required error={fieldErrors.primaryRole}>
              <input
                aria-required="true"
                aria-invalid={Boolean(fieldErrors.primaryRole)}
                className={[inputBase, fieldErrors.primaryRole ? invalidClass : ""].join(" ")}
                value={primaryRole}
                onChange={(event) => {
                  setPrimaryRole(event.target.value);
                  clearFieldError("primaryRole");
                }}
                placeholder="Video editor"
              />
            </Field>
            <Field label={<LabelWithIcon icon="cap">Years of experience</LabelWithIcon>} targetId="talent-experience">
              <select
                className={selectBase}
                aria-label="Years of experience"
                value={experienceYears}
                onChange={(event) => setExperienceYears(event.target.value)}
              >
                <option value="" className="bg-[#0b0b0f]">
                  Select years
                </option>
                <option value="0" className="bg-[#0b0b0f]">
                  Less than 1 year
                </option>
                {experienceOptions.map((value) => (
                  <option key={`talent-exp-${value}`} value={value} className="bg-[#0b0b0f]">
                    {value} {value === "1" ? "year" : "years"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={<LabelWithIcon icon="laptop">Work mode</LabelWithIcon>} required error={fieldErrors.workMode}>
              <select
                aria-required="true"
                aria-invalid={Boolean(fieldErrors.workMode)}
                className={[selectBase, fieldErrors.workMode ? invalidClass : ""].join(" ")}
                value={workMode}
                onChange={(event) => {
                  const next = event.target.value as TalentWorkMode;
                  setWorkMode(next);
                  clearFieldError("workMode");
                  if (next === "Remote") {
                    clearFieldError("location");
                  }
                }}
              >
                <option value="">Choose work mode</option>
                <option value="Remote">Remote</option>
                <option value="Hybrid">Hybrid</option>
                <option value="On-site">On-site</option>
              </select>
            </Field>
            <Field
              label={<LabelWithIcon icon="pin">Location</LabelWithIcon>}
              required={isTalentLocationRequired}
              error={fieldErrors.location}
            >
              <input
                aria-required={isTalentLocationRequired}
                aria-invalid={Boolean(fieldErrors.location)}
                className={[inputBase, fieldErrors.location ? invalidClass : ""].join(" ")}
                value={location}
                onChange={(event) => {
                  setLocation(event.target.value);
                  clearFieldError("location");
                }}
                placeholder={isTalentLocationRequired ? "Chennai" : "Remote, Chennai"}
              />
            </Field>
            <Field
              label={
                <LabelWithIcon icon="indian-rupee">
                  Rate <span className="text-white/50">*</span>
                </LabelWithIcon>
              }
              wide
              required
              error={fieldErrors.rateChoice || fieldErrors.rateRange}
            >
              <div className="space-y-3" data-quality-target="talent-rate">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-white/55">
                      ₹
                    </span>
                    <input
                      type="number"
                      min="0"
                      aria-required="true"
                      aria-invalid={Boolean(fieldErrors.rateRange)}
                      className={[inputBase, "pl-8", fieldErrors.rateRange ? invalidClass : ""].join(" ")}
                      value={rateMin}
                      onChange={(event) => {
                        setRateMin(event.target.value);
                        setRateIntent("");
                        setRateNote("");
                        clearFieldError("rateChoice");
                        clearFieldError("rateRange");
                      }}
                      placeholder="Min"
                    />
                  </div>
                  <span className="hidden text-base text-white/50 select-none sm:inline-flex">–</span>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-white/55">
                      ₹
                    </span>
                    <input
                      type="number"
                      min="0"
                      aria-required="true"
                      aria-invalid={Boolean(fieldErrors.rateRange)}
                      className={[inputBase, "pl-8", fieldErrors.rateRange ? invalidClass : ""].join(" ")}
                      value={rateMax}
                      onChange={(event) => {
                        setRateMax(event.target.value);
                        setRateIntent("");
                        setRateNote("");
                        clearFieldError("rateChoice");
                        clearFieldError("rateRange");
                      }}
                      placeholder="Max"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={choiceButton(rateIntent === "contact" && !rateNote.trim())}
                    onClick={() => {
                      setRateIntent("contact");
                      setRateMin("");
                      setRateMax("");
                      setRateNote("");
                      clearFieldError("rateChoice");
                      clearFieldError("rateRange");
                    }}
                  >
                    Contact for pricing
                  </button>
                  <button
                    type="button"
                    className={choiceButton(rateIntent === "flexible" && !rateNote.trim())}
                    onClick={() => {
                      setRateIntent("flexible");
                      setRateMin("");
                      setRateMax("");
                      setRateNote("");
                      clearFieldError("rateChoice");
                      clearFieldError("rateRange");
                    }}
                  >
                    Flexible
                  </button>
                </div>
              </div>
            </Field>
          </div>
        </StepShell>
      );
    }

    if (step === "details") {
      return (
        <StepShell title="Details" icon="sliders-horizontal" footer={footerActions}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={<LabelWithIcon icon="clock">Turnaround</LabelWithIcon>}>
              <input
                className={inputBase}
                value={turnaround}
                onChange={(event) => setTurnaround(event.target.value)}
                placeholder="24-48 hours, weekly, ongoing"
              />
            </Field>
            <Field label={<LabelWithIcon icon="globe">Timezone</LabelWithIcon>}>
              <input
                className={inputBase}
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                placeholder="IST"
              />
            </Field>
            <div className="sm:col-span-2" data-quality-target="talent-languages">
              <LanguagePicker value={languages} onChange={setLanguages} idPrefix="post-talent" enableGlobalPicker />
            </div>
          </div>
        </StepShell>
      );
    }

    if (step === "services") {
      return (
        <StepShell title="Services" icon="briefcase" footer={footerActions}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={<LabelWithIcon icon="users">Roles</LabelWithIcon>} wide>
              <input
                className={inputBase}
                value={roles}
                onChange={(event) => setRoles(event.target.value)}
                placeholder="Video editor, thumbnail designer"
              />
            </Field>
            <Field label={<LabelWithIcon icon="list-checks">Services offered</LabelWithIcon>} wide targetId="talent-services">
              <ServicesBulletEditor value={description} onChange={setDescription} />
            </Field>
          </div>
        </StepShell>
      );
    }

    if (step === "creatorContext") {
      return (
        <StepShell title="Creator context" icon="sparkles" footer={footerActions}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-4 sm:col-span-2" data-quality-target="talent-creator-context">
              <CreatorContextChipField
                label="Content niches"
                helper="Choose the content areas you work in."
                icon="sparkles"
                targetId="talent-content-niches"
                value={contentNichesList}
                suggestions={CONTENT_NICHE_SUGGESTIONS}
                onChange={(next) => {
                  const normalized = normalizeCreatorContextList(next);
                  setContentNiches(normalized);
                  setNiche(normalized.join(" · "));
                }}
              />
              <CreatorContextChipField
                label="Genres"
                helper="Select the content styles you support."
                icon="layers"
                targetId="talent-content-genres"
                value={contentGenresList}
                suggestions={CONTENT_GENRE_SUGGESTIONS}
                onChange={(next) => setContentGenres(normalizeCreatorContextList(next))}
              />
              <CreatorContextChipField
                label="Formats offered"
                helper="Choose the services you offer."
                icon="layout-grid"
                targetId="talent-formats-offered"
                value={formatsList}
                suggestions={FORMATS_HIRED_FOR_SUGGESTIONS}
                onChange={(next) => setFormats(normalizeCreatorContextList(next).join(", "))}
              />
            </div>
            <Field label={<LabelWithIcon icon="screen">Platforms</LabelWithIcon>} wide targetId="talent-platforms">
              <input
                className={inputBase}
                value={platforms}
                onChange={(event) => setPlatforms(event.target.value)}
                placeholder="YouTube, Instagram, TikTok"
              />
            </Field>
          </div>
        </StepShell>
      );
    }

    if (step === "toolsPortfolio") {
      return (
        <StepShell title="Tools & portfolio" icon="images" footer={footerActions}>
          <div className="space-y-4">
            <div className="max-w-[680px] min-w-0" data-quality-target="talent-tools">
              <ToolPicker
                value={tools}
                onChange={setTools}
                inputId="post-talent-tools-picker"
                className="space-y-2"
                placeholder="Premiere Pro, DaVinci Resolve, Figma..."
              />
            </div>
            {portfolioLoading ? (
              <p className="text-sm text-white/55">Loading portfolio projects...</p>
            ) : workSampleItems.length ? (
              <div className="grid max-w-[680px] min-w-0 gap-2.5 rounded-2xl" data-quality-target="talent-portfolio">
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-white/55">
                  <Icon name="images" className="h-4 w-4 text-white/55" />
                  Public portfolio/work samples
                </span>
                {workSampleItems.slice(0, 4).map((item) => {
                  const selected = selectedPortfolioIds.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => togglePortfolio(item.id)}
                      className={[
                        "cursor-pointer rounded-xl border px-3 py-2.5 text-left transition-colors",
                        selected ? "border-white/30 bg-white/[0.10]" : "border-white/10 bg-white/[0.04] hover:bg-white/[0.07]",
                      ].join(" ")}
                    >
                      <p className="line-clamp-1 text-sm font-semibold text-white/88">{item.title}</p>
                      <p className="mt-1 line-clamp-1 text-xs text-white/48">
                        {[item.role_name || item.role || item.user_role_in_project, item.source_type, item.tools?.slice(0, 2).join(" · ")]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="max-w-[680px] rounded-2xl border border-white/10 bg-white/[0.04] p-5" data-quality-target="talent-portfolio">
                <p className="text-sm font-semibold text-white/86">No public portfolio projects yet.</p>
                <p className="mt-2 text-sm leading-6 text-white/55">
                  You can publish now and add work samples later, or add projects before creating this listing.
                </p>
                <Link
                  href="/you?tab=portfolio"
                  className="mt-4 inline-flex cursor-pointer rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-white/74 transition hover:bg-white/[0.06] hover:text-white"
                >
                  Open portfolio →
                </Link>
              </div>
            )}
          </div>
        </StepShell>
      );
    }

    return (
      <StepShell title="Hiring requests" icon="clipboard-list" footer={footerActions}>
        <div data-quality-target="talent-first-message">
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-white/90">
            <Icon name="clipboard-list" className="h-4 w-4 text-white/55" />
            What recruiters must include
          </h3>
          <div className="mt-4">
            <RequirementSelector
              context="talent"
              selectedKeys={firstMessageRequirements}
              onChange={(next) => {
                setFirstMessageRequirements(next);
                if (firstMessageError) setFirstMessageError(null);
              }}
              noneSelected={noFirstMessageRequirements}
              onNoneChange={(next) => {
                setNoFirstMessageRequirements(next);
                if (firstMessageError) setFirstMessageError(null);
              }}
              customInstructionValue={firstMessageCustomInstruction}
              onCustomInstructionChange={(next) => {
                setFirstMessageCustomInstruction(next);
                if (firstMessageError) setFirstMessageError(null);
              }}
              customInstructionError={
                firstMessageRequirements.includes(CUSTOM_INSTRUCTION_REQUIREMENT_KEY)
                  ? firstMessageError || undefined
                  : undefined
              }
            />
          </div>
          {firstMessageError ? (
            <p className="mt-3 text-[13px] text-amber-200/90">{firstMessageError}</p>
          ) : null}
        </div>
      </StepShell>
    );
  };

  return (
    <main className="min-h-screen bg-[#0b0b0f] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto grid max-w-6xl items-start gap-6 lg:grid-cols-[1fr_390px]">
        <div className="space-y-6">
          <TalentListingProgressHeader
            title={draftId ? "EDIT TALENT LISTING" : "CREATE TALENT LISTING"}
            microcopy={STEP_MICROCOPY[step]}
            stepNumber={stepIndex + 1}
            totalSteps={STEPS.length}
            stepLabel={activeStep.label}
            progress={progress}
          />

          {error ? (
            <section className="rounded-2xl border border-amber-200/20 bg-amber-200/10 px-4 py-3 text-sm text-amber-50">
              {error}
            </section>
          ) : null}

          {renderStep()}
        </div>

        <aside className="space-y-6 lg:sticky lg:top-20">
          <TalentPreview
            title={title}
            primaryRole={primaryRole || rolesList[0] || ""}
            experience={experienceDisplay}
            location={location}
            timezone={timezone}
            workMode={workMode}
            niche={niche}
            contentNiches={contentNichesList}
            contentGenres={contentGenresList}
            formats={formatsList}
            platforms={platformsList}
            tools={tools}
            rateNote={effectiveRateNote}
            rateMin={rateMin}
            rateMax={rateMax}
            rateCurrency="INR"
          />
        </aside>
      </div>
      <RecommendedChecklistPopup
        items={talentQualityItems}
        onSelect={goToTalentQualityItem}
        ariaLabel="Recommended talent listing details"
      />
      <TalentPublishReadyDialog
        open={publishReadyOpen}
        missing={missingTalentQualityItems}
        onClose={() => setPublishReadyOpen(false)}
        onAddDetails={() => {
          const firstMissing = missingTalentQualityItems[0];
          if (firstMissing) goToTalentQualityItem(firstMissing);
        }}
        onPublishAnyway={() => {
          setPublishReadyOpen(false);
          void persistTalentListing("published");
        }}
        publishButtonRef={publishAnywayButtonRef}
      />
    </main>
  );
}
