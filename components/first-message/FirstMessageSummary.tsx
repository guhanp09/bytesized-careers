"use client";

import { safeExternalHref } from "../../lib/externalHref";
import React, { Fragment } from "react";
import {
  CUSTOM_INSTRUCTION_REQUIREMENT_KEY,
  FirstMessageAnswers,
  RequirementContext,
  RequirementIcon,
  RequirementSummaryItem,
  summarizeAnswers,
} from "../../lib/firstMessageRequirements";
import type { BackendPortfolioItem } from "../../lib/backendClient";
import { toCreatorPortfolioItem, type PortfolioInput } from "../../lib/creatorProjection";
import { PortfolioPoster } from "../you/PortfolioPreview";
import { SCREENING_ANSWERS_KEY } from "../../lib/jobApplication";
import { applicationRequirementLabel } from "../../lib/jobPresentation";
import { Icon } from "../Icons";
import { usePortfolioDetailPopup } from "../profile/PortfolioDetailPopup";

type SummaryLink = NonNullable<RequirementSummaryItem["links"]>[number];

/** YouTube video id from a watch/short/youtu.be URL, or null. */
function youTubeId(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") return u.pathname.slice(1) || null;
    if (host.endsWith("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const m = u.pathname.match(/\/(shorts|embed)\/([^/?]+)/);
      if (m?.[2]) return m[2];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * A summary link as portfolio evidence.
 *
 * The generic icon square this replaces said "there is a link here". A poster
 * says what the work is — and for a creator marketplace that is the difference
 * between a list of URLs and a portfolio. Reuses the same converter the detail
 * popover uses, so both read the item identically.
 */
function creatorItemFromSummaryLink(link: SummaryLink) {
  return toCreatorPortfolioItem(portfolioItemFromSummaryLink(link) as PortfolioInput);
}

function portfolioItemFromSummaryLink(link: SummaryLink): BackendPortfolioItem {
  const tags = link.tags ?? [];
  const ytId = youTubeId(link.url);
  return {
    id: link.id || link.url || link.label,
    user_id: "first-message",
    title: link.label,
    source_type: ytId ? "youtube" : "other",
    source_url: link.url || null,
    youtube_url: ytId ? link.url || null : null,
    thumbnail_url: ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null,
    links: link.url ? [link.url] : [],
    // Rich context surfaces in the detail popover: description → "What I did",
    // role → the contribution line, metrics → highlights, tags, tools, and
    // timestamp notes (deep-link into the video when it's a YouTube URL).
    description: link.description || null,
    role_name: link.role || null,
    user_role_in_project: link.role || null,
    channel_name: link.platform || null,
    contribution_highlights: link.metrics ?? [],
    contribution_tags: tags,
    tags,
    tools: link.tools ?? [],
    timestamp_notes: link.timestampNotes ?? [],
    status: "past",
    is_public: true,
    // Opening-message references do not carry portfolio timestamps. Empty values
    // keep the shared popover from presenting a fabricated publication date.
    created_at: "",
    updated_at: "",
  };
}

/** Host + trimmed path for a link card's muted sub-label. */
function displayUrl(url?: string): string {
  if (!url) return "";
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const path = u.pathname !== "/" ? u.pathname : "";
    return (u.hostname.replace(/^www\./, "") + path).replace(/\/$/, "");
  } catch {
    return url;
  }
}

/**
 * Group heading. Sentence case at a legible size rather than tracked-out
 * micro-caps: uppercase at 10.5px is the least readable text in a UI, and it
 * was being used for *every* group, so nothing stood out from anything else.
 */
const SECTION_LABEL = "text-[11.5px] font-semibold text-secondary";

/**
 * A titled group of link mini-cards — the shared design + behaviour for BOTH the
 * Portfolio and Reference videos sections. They are functionally mirrored (a
 * talent showing work to a recruiter vs a recruiter showing references to a
 * talent), so they inherit from this one component: identical card layout and the
 * same anchored detail popover on click (the platform-wide popup pattern for
 * both). Editing this changes both; the sections differ only in data — heading,
 * icon, noun, and items.
 */
function LinkCardSection({
  heading,
  icon,
  noun,
  links,
  showPosters = false,
  onOpen,
}: {
  heading: string;
  icon: RequirementIcon;
  noun: string;
  links: SummaryLink[];
  /** Portfolio evidence renders its artwork; other link kinds keep the icon. */
  showPosters?: boolean;
  onOpen: (link: SummaryLink, target: HTMLElement, point: { x: number; y: number }) => void;
}) {
  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-baseline gap-2">
        <span className={SECTION_LABEL}>{heading}</span>
        <span className="text-[11px] tabular-nums text-subtle">
          {links.length} {links.length === 1 ? noun : `${noun}s`}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {links.map((link, idx) => {
          // Prefer meaningful context — a reference's "what to match" note, then a
          // portfolio's type · top metric — over the bare domain, which is only a
          // fallback when it adds information beyond the title.
          const contextSubtitle = link.note?.trim() || [link.type, link.metrics?.[0]].filter(Boolean).join(" · ");
          const domain = link.url ? displayUrl(link.url) : "";
          const subtitle = contextSubtitle || (domain.toLowerCase() !== link.label.toLowerCase() ? domain : "");
          const tags = (link.tags ?? []).slice(0, 3);
          const inner = (
            <>
              {showPosters ? (
                <PortfolioPoster item={creatorItemFromSummaryLink(link)} size="sm" className="mt-0.5" />
              ) : (
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-muted">
                  <Icon name={icon} className="h-4 w-4" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-white/90">{link.label}</span>
                {subtitle ? <span className="block truncate text-[11px] text-subtle">{subtitle}</span> : null}
                {tags.length ? (
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-white/55"
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
              {link.url ? (
                <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-subtle transition-colors group-hover:text-white/65">
                  Open
                  <Icon name="external-link" className="h-3 w-3" />
                </span>
              ) : null}
            </>
          );
          const cardClass =
            "group flex items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2.5 text-left transition-colors hover:border-white/15 hover:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-white/18";
          return link.url ? (
            <button
              key={`${link.id ?? link.url ?? link.label}-${idx}`}
              type="button"
              onClick={(event) => onOpen(link, event.currentTarget, { x: event.clientX, y: event.clientY })}
              className={`${cardClass} w-full cursor-pointer`}
            >
              {inner}
            </button>
          ) : (
            <div key={`${link.label}-${idx}`} className={cardClass}>
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Native rendering of a requester's structured opening-message answers — shown
 * directly beneath their message bubble in the inbox as a polished application
 * summary card: a dominant budget/rate headline, compact icon·label·value detail
 * rows, mirrored Portfolio / Reference videos card groups, a quoted Fit note, and
 * a Screener block (the listing owner's screening question above the applicant's
 * answer). Never renders raw JSON, field keys, or a wrapper heading.
 *
 * Backward compatible: when there are no structured answers, it renders nothing,
 * so legacy free-text-only messages are unaffected.
 */
export default function FirstMessageSummary({
  context,
  answers,
  requirementKeys,
  className = "",
}: {
  context: RequirementContext;
  answers: FirstMessageAnswers | null | undefined;
  requirementKeys?: string[];
  className?: string;
}) {
  const portfolioPopup = usePortfolioDetailPopup("first-message-portfolio-popup");
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return null;
  const keys = requirementKeys?.length ? requirementKeys : Object.keys(answers);
  const items = summarizeAnswers(keys, context, answers);
  const rawScreening = answers[SCREENING_ANSWERS_KEY];
  const screeningAnswers = Array.isArray(rawScreening)
    ? rawScreening.filter(
        (value): value is { question_index: number; prompt: string; required: boolean; response: string; response_guidance?: string | null } =>
          Boolean(value) &&
          typeof value === "object" &&
          typeof (value as { prompt?: unknown }).prompt === "string" &&
          typeof (value as { response?: unknown }).response === "string",
      )
    : [];
  const knownKeys = new Set(items.map((item) => item.key));
  const additionalAnswers = Object.entries(answers)
    .filter(([key, value]) => key !== SCREENING_ANSWERS_KEY && !knownKeys.has(key) && typeof value === "string" && value.trim())
    .map(([key, value]) => ({ key, label: applicationRequirementLabel(key), response: String(value).trim() }));
  if (!items.length && !screeningAnswers.length && !additionalAnswers.length) return null;

  // Both link-card sections open the one shared detail popover on click.
  const openLinkPopup = (link: SummaryLink, target: HTMLElement, point: { x: number; y: number }) => {
    portfolioPopup.open(portfolioItemFromSummaryLink(link), target, point);
  };

  // Partition the flat item list into the card's visual sections. The rate/budget
  // is the headline; portfolio and reference videos each read as a card group;
  // fit note and screener read on their own; everything else is a compact row.
  const budget = items.find((item) => item.emphasis && item.text);
  const portfolio = items.find((item) => item.key === "relevant_portfolio");
  const referenceVideos = items.find((item) => item.key === "reference_links");
  const fitNote = items.find((item) => item.key === "fit_note");
  const screener = items.find((item) => item.key === CUSTOM_INSTRUCTION_REQUIREMENT_KEY);
  const rows = items.filter(
    (item) =>
      item !== budget &&
      item !== portfolio &&
      item !== referenceVideos &&
      item !== fitNote &&
      item !== screener
  );

  // The rate reads as "₹2,800 per project": split the headline amount from its
  // muted cadence so the amount can dominate.
  const budgetText = budget?.text ?? "";
  const budgetMatch = budgetText.match(/^(\S+)\s*(.*)$/);
  const budgetAmount = budgetMatch ? budgetMatch[1] : budgetText;
  const budgetCadence = budgetMatch ? budgetMatch[2] : "";

  const renderLink = (link: SummaryLink, idx: number) =>
    link.kind === "portfolio" && link.url ? (
      <button
        key={`${link.id ?? link.url ?? link.label}-${idx}`}
        type="button"
        onClick={(event) =>
          portfolioPopup.open(portfolioItemFromSummaryLink(link), event.currentTarget, {
            x: event.clientX,
            y: event.clientY,
          })
        }
        className="inline-flex max-w-full cursor-pointer items-center gap-1.5 text-left font-medium text-blue-300 underline-offset-4 transition-colors hover:text-blue-200 hover:underline focus:outline-none focus:ring-2 focus:ring-white/18"
      >
        <span className="min-w-0 truncate">{link.label}</span>
        <Icon name="external-link" className="h-3 w-3 shrink-0 opacity-70" />
      </button>
    ) : link.url ? (
      <a
        key={`${link.url}-${idx}`}
        href={safeExternalHref(link.url)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex max-w-full cursor-pointer items-center gap-1.5 font-medium text-blue-300 underline-offset-4 transition-colors hover:text-blue-200 hover:underline focus:outline-none focus:ring-2 focus:ring-white/18"
      >
        <span className="min-w-0 truncate">{link.label}</span>
        <Icon name="external-link" className="h-3 w-3 shrink-0 opacity-70" />
      </a>
    ) : (
      <span key={`${link.label}-${idx}`} className="text-blue-300">
        {link.label}
      </span>
    );

  const sections: { key: string; node: React.ReactNode }[] = [];

  if (budget) {
    sections.push({
      key: "budget",
      node: (
        <div className="px-4 pt-3.5 pb-3">
          {/* Inline (not flex) with a real space so the amount + cadence read as
              one string ("₹1,000 per month") in the accessible text, while the
              amount still dominates visually. */}
          <p className="text-[13px] leading-none text-muted">
            <span className="align-baseline text-[1.7rem] font-bold tracking-tight text-white">
              {budgetAmount}
            </span>
            {budgetCadence ? <> {budgetCadence}</> : null}
          </p>
        </div>
      ),
    });
  }

  if (rows.length) {
    sections.push({
      key: "rows",
      node: (
        /*
          A definition list whose label column sizes to its longest label, so a
          value never floats a hundred pixels away from the word describing it.
          The previous fixed 112px column produced exactly that gap, and it grew
          worse the narrower the rail became.

          Below about 256px there is no room for two columns at all, and the card
          gets exactly that inside a mobile message thread. Left as a grid it
          rendered "Mornings, overlapping with EU" one letter per line, and
          shrinking the label track only made the label overlap the answer.

          So it stacks — decided by the card's own width rather than the
          viewport's, because this card also appears in narrow desktop rails
          where a media query would say "wide" and be wrong.
        */
        <div className="@container/answers px-4 py-3">
        {/* The query element must be an ancestor: a container sizes its
            descendants, never itself. */}
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-[13px] leading-relaxed @[16rem]/answers:grid-cols-[minmax(0,auto)_minmax(6rem,1fr)] @[16rem]/answers:items-baseline @[16rem]/answers:gap-y-2">
          {rows.map((item) => (
            <Fragment key={item.key}>
              <dt className="flex items-start gap-2 text-subtle">
                <Icon name={item.icon} className="mt-[3px] h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0">{item.label}</span>
              </dt>
              <dd className="min-w-0 pb-1.5 text-default @[16rem]/answers:pb-0">
                {item.text && !item.links?.length ? (
                  <p className="whitespace-pre-wrap break-words">{item.text}</p>
                ) : null}
                {item.links?.length ? (
                  <span className="flex flex-col items-start gap-1">{item.links.map(renderLink)}</span>
                ) : null}
              </dd>
            </Fragment>
          ))}
        </dl>
        </div>
      ),
    });
  }

  if (portfolio?.links?.length) {
    sections.push({
      key: "portfolio",
      node: (
        <LinkCardSection
          heading="Portfolio"
          icon="images"
          noun="item"
          links={portfolio.links}
          showPosters
          onOpen={openLinkPopup}
        />
      ),
    });
  }

  if (referenceVideos?.links?.length) {
    // Keep a real title when the reference carries one; otherwise a bare URL
    // (often a YouTube "/watch" link that would collide) gets a stable indexed
    // title — matching the platform's own reference-video cards.
    const referenceLinks = referenceVideos.links.map((link, i) => {
      const urlDerived = link.url ? displayUrl(link.url).toLowerCase() === link.label.toLowerCase() : true;
      return { ...link, label: urlDerived ? `Reference video ${i + 1}` : link.label };
    });
    sections.push({
      key: "reference-videos",
      node: (
        <LinkCardSection
          heading="Reference videos"
          icon="circle-play"
          noun="video"
          links={referenceLinks}
          onOpen={openLinkPopup}
        />
      ),
    });
  }

  if (fitNote?.text) {
    sections.push({
      key: "fit-note",
      node: (
        <div className="px-4 py-3">
          <span className={`mb-1.5 block ${SECTION_LABEL}`}>Fit note</span>
          <p className="text-[13px] italic leading-relaxed text-white/75">“{fitNote.text}”</p>
        </div>
      ),
    });
  }

  if (screener && (screener.text || screener.links?.length)) {
    sections.push({
      key: "screener",
      node: (
        <div className="px-4 py-3">
          <span className={`mb-1.5 block ${SECTION_LABEL}`}>Screener</span>
          {screener.prompt ? (
            <p className="text-[13px] leading-relaxed text-muted">{screener.prompt}</p>
          ) : null}
          <div className="mt-2 border-l-2 border-blue-400/40 pl-3">
            {screener.text ? (
              <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/85">
                {screener.text}
              </p>
            ) : null}
            {screener.links?.length ? (
              <span className="mt-1.5 flex flex-col items-start gap-1 text-[13px]">
                {screener.links.map(renderLink)}
              </span>
            ) : null}
          </div>
        </div>
      ),
    });
  }

  if (screeningAnswers.length) {
    sections.push({
      key: "screening-questions",
      node: (
        <div className="px-4 py-3">
          <span className={`mb-3 block ${SECTION_LABEL}`}>Screening questions</span>
          <ol className="space-y-3">
            {screeningAnswers.map((answer, index) => (
              <li key={`${answer.question_index}-${answer.prompt}-${index}`} className="min-w-0">
                <p className="break-words text-[12px] leading-relaxed text-muted">
                  {answer.prompt}
                  <span className="ml-1.5 text-[10px] uppercase tracking-[0.1em] text-subtle">
                    {answer.required ? "Required" : "Optional"}
                  </span>
                </p>
                <p className={answer.response.trim() ? "mt-1.5 border-l-2 border-blue-400/40 pl-3 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/85" : "mt-1.5 border-l-2 border-white/10 pl-3 text-[12px] italic text-subtle"}>
                  {answer.response.trim() || "No optional answer provided"}
                </p>
              </li>
            ))}
          </ol>
        </div>
      ),
    });
  }

  if (additionalAnswers.length) {
    sections.push({
      key: "additional-details",
      node: (
        <div className="px-4 py-3">
          <span className={`mb-3 block ${SECTION_LABEL}`}>Additional details</span>
          <dl className="space-y-3">
            {additionalAnswers.map((answer) => (
              <div key={answer.key}>
                <dt className="text-[12px] text-muted">{answer.label}</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/85">{answer.response}</dd>
              </div>
            ))}
          </dl>
        </div>
      ),
    });
  }

  return (
    <div
      className={[
        "min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025] shadow-[0_10px_30px_-24px_rgba(0,0,0,0.9)]",
        className,
      ].join(" ")}
    >
      {sections.map((section, idx) => (
        <React.Fragment key={section.key}>
          {idx > 0 ? <div className="h-px bg-white/[0.06]" /> : null}
          {section.node}
        </React.Fragment>
      ))}
      {portfolioPopup.popover}
    </div>
  );
}
