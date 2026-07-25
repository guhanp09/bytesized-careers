"use client";

import React from "react";
import { Icon } from "../Icons";
import PreviewCard from "../post-job/PreviewCard";
import PostJobSafety from "../post-job/PostJobSafety";
import { JOB_CATEGORIES } from "../../lib/importJob/categoryMap";
import { IMPORT_FIELD_LABELS, toWizardPrefill } from "../../lib/importJob/applyToWizard";
import type { JobCategory } from "../../lib/types";
import type {
  FieldExtraction,
  ImportFieldKey,
  ImportParseResult,
} from "../../lib/importJob/types";
import {
  importAmberTextClass,
  importEvidenceClass,
  importGhostButton,
  importGroupClass,
  importGroupHeadingClass,
  importHelperClass,
  importPill,
  importPrimaryButton,
  importSuggestedPill,
} from "./importPrimitives";

const START_LABELS: Record<string, string> = {
  ASAP: "ASAP",
  "<1mo": "Within 1 month",
  "<2mo": "Within 2 months",
  "<3mo": "Within 3 months",
  Flexible: "Flexible",
};

const REQUIREMENT_LABELS: Record<string, string> = {
  relevant_portfolio: "portfolio",
  expected_rate: "expected rate",
  start_availability: "availability",
};

// Publish-required fields listed first inside the Missing group.
const PUBLISH_REQUIRED: ImportFieldKey[] = ["title", "platforms", "workMode", "budget", "about"];

function truncate(value: string, max = 80): string {
  const points = Array.from(value);
  return points.length > max ? `${points.slice(0, max - 1).join("")}…` : value;
}

function previewValue(key: ImportFieldKey, extraction: FieldExtraction<unknown>): string {
  const value = extraction.value;
  if (value === null || value === undefined) return "";
  switch (key) {
    case "budget": {
      const b = value as { min: string; max: string; unit: string; intent: string };
      if (b.intent === "contact") return "Contact for pricing";
      if (b.intent === "flexible") return "Flexible";
      if (!b.min || !b.max) return "";
      const fmt = (n: string) => `₹${Number(n).toLocaleString("en-US")}`;
      return b.min === b.max ? `${fmt(b.min)} ${b.unit}` : `${fmt(b.min)}–${fmt(b.max)} ${b.unit}`;
    }
    case "experience": {
      const e = value as { min: string; max: string };
      return e.min === e.max ? `${e.min} years` : `${e.min}–${e.max} years`;
    }
    case "startWithin":
      return START_LABELS[value as string] ?? String(value);
    case "turnaround": {
      const t = value as { value: number; unit: string };
      return `${t.value} ${t.unit}`;
    }
    case "responsibilities":
    case "requirements": {
      const lines = String(value).split("\n").filter(Boolean);
      return `${lines.length} point${lines.length === 1 ? "" : "s"}`;
    }
    case "refVideos": {
      const list = value as unknown[];
      return `${list.length} video${list.length === 1 ? "" : "s"}`;
    }
    default:
      if (Array.isArray(value)) return truncate(value.join(", "));
      return truncate(String(value));
  }
}

function FieldRow({
  fieldKey,
  extraction,
  tone,
  suffix,
}: {
  fieldKey: ImportFieldKey;
  extraction: FieldExtraction<unknown>;
  tone: "imported" | "review" | "missing" | "unsupported";
  suffix?: string;
}) {
  const label = IMPORT_FIELD_LABELS[fieldKey];
  const value = previewValue(fieldKey, extraction);
  const snippet = extraction.evidence[0]?.snippet;
  return (
    <li className="py-2.5 first:pt-0 last:pb-0" data-testid={`import-row-${fieldKey}`}>
      <div className="flex items-start gap-2">
        {tone === "imported" ? (
          <Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/70" />
        ) : tone === "review" ? (
          <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-200/90" />
        ) : (
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-white/20" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <p className={`text-sm ${tone === "missing" ? "text-subtle" : "text-white/85"}`}>
            <span className="font-semibold">{label}</span>
            {value ? <span className="text-white/60"> — {value}</span> : null}
            {suffix ? <span className="text-subtle"> {suffix}</span> : null}
          </p>
          {snippet && tone !== "missing" ? <p className={importEvidenceClass}>“{snippet}”</p> : null}
          {extraction.note ? <p className={`${importHelperClass} mt-1`}>{extraction.note}</p> : null}
        </div>
      </div>
    </li>
  );
}

function ChipGroup({
  label,
  helper,
  options,
  selected,
  suggested,
  onSelect,
  testPrefix,
  accent,
}: {
  label: string;
  helper?: string;
  options: string[];
  selected: string | null;
  suggested?: string | null;
  onSelect: (value: string) => void;
  testPrefix: string;
  accent?: string;
}) {
  const groupRef = React.useRef<HTMLDivElement | null>(null);
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const current = selected ? options.indexOf(selected) : -1;
    const next = current === -1 ? 0 : (current + (forward ? 1 : -1) + options.length) % options.length;
    onSelect(options[next]);
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]");
    buttons?.[next]?.focus();
  };
  return (
    <div className={importGroupClass}>
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-white/85">{label}</p>
        {accent ? <Icon name="alert" className="h-3.5 w-3.5 text-amber-200/90" /> : null}
      </div>
      {helper ? <p className={`${importHelperClass} mt-1`}>{helper}</p> : null}
      {accent ? <p className={`${importAmberTextClass} mt-1`}>{accent}</p> : null}
      <div
        ref={groupRef}
        role="radiogroup"
        aria-label={label}
        onKeyDown={handleKeyDown}
        className="mt-3 flex flex-wrap gap-2"
      >
        {options.map((option) => {
          const isSelected = selected === option;
          const isSuggested = !isSelected && suggested === option && selected === null;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected || (selected === null && option === options[0]) ? 0 : -1}
              className={isSuggested ? importSuggestedPill : importPill(isSelected)}
              onClick={() => onSelect(option)}
              data-testid={`${testPrefix}-${option.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            >
              {option}
              {isSuggested ? <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted">Suggested</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ReviewSummary({
  result,
  chosenTitleIndex,
  chosenCategory,
  suggestedCategoryValue,
  handingOff,
  onSelectTitle,
  onSelectCategory,
  onContinue,
  onBackToEdit,
  onStartOver,
}: {
  result: ImportParseResult;
  chosenTitleIndex: number | null;
  chosenCategory: JobCategory | null;
  suggestedCategoryValue: JobCategory;
  handingOff: boolean;
  onSelectTitle: (index: number) => void;
  onSelectCategory: (category: JobCategory) => void;
  onContinue: () => void;
  onBackToEdit: () => void;
  onStartOver: () => void;
}) {
  const summaryRef = React.useRef<HTMLHeadingElement | null>(null);
  React.useEffect(() => {
    summaryRef.current?.focus();
  }, []);

  const draft = result.draft;
  const entries = (Object.entries(draft) as Array<[ImportFieldKey, FieldExtraction<unknown>]>).filter(
    ([key]) => key !== "applicationSignals"
  );

  const imported = entries.filter(([, e]) => e.status === "imported" && e.value !== null);
  const review = entries.filter(([, e]) => e.status === "review" || e.status === "conflict");
  const missing = entries
    .filter(([, e]) => e.status === "missing")
    .sort(([a], [b]) => Number(PUBLISH_REQUIRED.includes(b)) - Number(PUBLISH_REQUIRED.includes(a)));
  const unsupported = entries.filter(([, e]) => e.status === "unsupported");
  const signals = draft.applicationSignals;

  const summarySentence = [
    `We found ${imported.length} detail${imported.length === 1 ? "" : "s"}`,
    review.length ? `${review.length} need${review.length === 1 ? "s" : ""} a look` : "",
    missing.length ? `${missing.length} ${missing.length === 1 ? "is" : "are"} missing` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const categoryUnconfirmed = chosenCategory === null;
  const continueDisabled = handingOff || categoryUnconfirmed;

  // Live PreviewCard feed via the same mapping the wizard will receive.
  const { prefill } = toWizardPrefill(result, chosenTitleIndex, chosenCategory ?? suggestedCategoryValue);
  const previewCard = (
    <PreviewCard
      title={prefill.title}
      channelName=""
      subsText=""
      budgetText={prefill.previewBudgetText}
      experienceText={prefill.previewExperienceText}
      locationText={prefill.previewLocationText}
      tags={prefill.tags}
      contentNiches={prefill.contentNiches}
      contentGenres={prefill.contentGenres}
      formatsHiredFor={prefill.formatsHiredFor}
      platform={prefill.platform || undefined}
    />
  );

  const titleAlternatives = draft.title.status === "conflict" ? draft.title.alternatives ?? [] : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]" data-testid="import-review">
      <div className="min-w-0 space-y-4">
        <section className={importGroupClass} data-testid="import-summary">
          <h2 ref={summaryRef} tabIndex={-1} className="text-lg font-semibold text-white outline-none">
            Draft prepared
          </h2>
          <p className="mt-1 text-sm text-white/60">{summarySentence}.</p>
        </section>

        {/* Mobile preview */}
        <details className="lg:hidden">
          <summary className={`${importGhostButton} inline-flex cursor-pointer items-center`}>Preview card</summary>
          <div className="mt-3">{previewCard}</div>
        </details>

        {titleAlternatives.length > 0 ? (
          <ChipGroup
            label="This post mentions more than one role — which one is this job for?"
            helper="You can import again for the other role."
            options={titleAlternatives.map((a) => a.value)}
            selected={chosenTitleIndex !== null ? titleAlternatives[chosenTitleIndex]?.value ?? null : null}
            onSelect={(value) => onSelectTitle(titleAlternatives.findIndex((a) => a.value === value))}
            testPrefix="import-title-alt"
          />
        ) : null}

        <ChipGroup
          label="Category"
          helper="How this job is grouped on the Jobs page."
          options={JOB_CATEGORIES}
          selected={chosenCategory}
          suggested={suggestedCategoryValue}
          onSelect={(value) => onSelectCategory(value as JobCategory)}
          testPrefix="import-category"
          accent={
            categoryUnconfirmed
              ? draft.category.note ?? "We weren't sure about the category — pick one to continue."
              : undefined
          }
        />

        {imported.length > 0 ? (
          <section className={importGroupClass}>
            <h3 className={importGroupHeadingClass}>Imported</h3>
            <ul className="mt-2 divide-y divide-white/[0.06]">
              {imported.map(([key, extraction]) => (
                <FieldRow key={key} fieldKey={key} extraction={extraction} tone="imported" />
              ))}
            </ul>
          </section>
        ) : null}

        {review.length > 0 ? (
          <section className={importGroupClass}>
            <h3 className={`${importGroupHeadingClass} text-amber-200/80`}>Please review</h3>
            <ul className="mt-2 divide-y divide-white/[0.06]">
              {review.map(([key, extraction]) => (
                <FieldRow key={key} fieldKey={key} extraction={extraction} tone="review" />
              ))}
            </ul>
          </section>
        ) : null}

        {missing.length > 0 ? (
          <section className={importGroupClass}>
            <h3 className={importGroupHeadingClass}>Missing</h3>
            <ul className="mt-2 divide-y divide-white/[0.06]">
              {missing.map(([key, extraction]) => (
                <FieldRow
                  key={key}
                  fieldKey={key}
                  extraction={extraction}
                  tone="missing"
                  suffix={PUBLISH_REQUIRED.includes(key) ? "· needed to publish" : undefined}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {signals.contactLines.length > 0 ? (
          <section className={importGroupClass} data-testid="import-signals">
            <h3 className={importGroupHeadingClass}>Application instructions from your post</h3>
            <p className="mt-2 text-sm text-white/70">
              Applications on CreatorJobs arrive in your Inbox — external contact details aren&apos;t copied
              into your listing.
            </p>
            <ul className="mt-2 space-y-1.5">
              {signals.contactLines.map((line, index) => (
                <li key={`${line.start}-${index}`} className={importEvidenceClass}>
                  “{line.snippet}”
                </li>
              ))}
            </ul>
            {signals.suggestedRequirements.length > 0 ? (
              <p className="mt-3 text-sm text-white/70">
                We&apos;ll ask applicants for:{" "}
                <span className="text-white/90">
                  {signals.suggestedRequirements.map((key) => REQUIREMENT_LABELS[key] ?? key).join(" · ")}
                </span>
              </p>
            ) : null}
            <p className={`${importHelperClass} mt-2`}>
              Want a contact detail public anyway? Add it yourself in the editor.
            </p>
          </section>
        ) : null}

        {unsupported.length > 0 ? (
          <section className={importGroupClass}>
            <h3 className={importGroupHeadingClass}>Couldn&apos;t be carried over</h3>
            <ul className="mt-2 divide-y divide-white/[0.06]">
              {unsupported.map(([key, extraction]) => (
                <FieldRow key={key} fieldKey={key} extraction={extraction} tone="unsupported" />
              ))}
            </ul>
          </section>
        ) : null}

        {result.unmapped.length > 0 ? (
          <details className={importGroupClass}>
            <summary className="cursor-pointer text-sm font-semibold text-white/60">
              Lines we left out ({result.unmapped.length})
            </summary>
            <ul className="mt-2 space-y-1.5">
              {result.unmapped.map((line, index) => (
                <li key={index} className="text-[12px] leading-relaxed text-muted break-words">
                  {line}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-white/10 bg-[#0b0b0f]/95 px-4 py-3 backdrop-blur sm:static sm:m-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <button type="button" className={importGhostButton} onClick={onStartOver} data-testid="import-start-over">
            Start over
          </button>
          <button type="button" className={importGhostButton} onClick={onBackToEdit} data-testid="import-back-to-edit">
            Edit pasted text
          </button>
          <button
            type="button"
            className={importPrimaryButton}
            onClick={onContinue}
            disabled={continueDisabled}
            aria-disabled={continueDisabled}
            title={categoryUnconfirmed ? "Pick a category to continue" : undefined}
            data-testid="import-continue"
          >
            {handingOff ? "Opening…" : "CONTINUE TO EDITOR"}
          </button>
        </div>
      </div>

      <aside className="hidden lg:block">
        <div className="sticky top-6 space-y-4">
          {previewCard}
          <PostJobSafety />
        </div>
      </aside>
    </div>
  );
}
