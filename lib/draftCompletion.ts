import type { BackendTalentListing } from "./backendClient";
import { creatorContextFieldCount, isCreatorContextComplete } from "./jobCreatorContext.ts";
import type { DraftItem } from "./ownerDrafts";
import type { Job } from "./types";

/**
 * Centralized, testable draft-completion model.
 *
 * Two independent dimensions are tracked so the Drafts workspace can answer two
 * different questions without conflating them:
 *   - Publish readiness  → required (publish-blocking) fields.  "Can I publish?"
 *   - Listing strength   → recommended (quality) fields.        "Is it strong?"
 *
 * Required/recommended sets mirror the actual publish validation and quality
 * nudges in the job (PostJobPage) and talent (PostTalentPage) creation forms.
 */

export type SectionState = "complete" | "publish-ready" | "needs-action" | "not-started";
export type DraftStatusKind = "ready" | "needs_action" | "needs_verification" | "not_started";
export type CompletionItemType = "required" | "recommended";

export type CompletionItem = {
  id: string;
  key: string;
  label: string;
  complete: boolean;
  done: boolean;
  type: CompletionItemType;
  required: boolean;
  target: string;
  /** Deep-link section key the editor understands (?section=…). */
  jump: string;
  actionLabel: string;
  helpText?: string;
  /** Checklist group this item belongs to. */
  group: string;
  groupLabel: string;
};

type CompletionItemInput = {
  id?: string;
  key: string;
  label: string;
  complete?: boolean;
  done: boolean;
  type?: CompletionItemType;
  required: boolean;
  target?: string;
  /** Deep-link section key the editor understands (?section=…). */
  jump: string;
  actionLabel?: string;
  helpText?: string;
  /** Checklist group this item belongs to. */
  group: string;
  groupLabel: string;
};

export type SectionStatus = { key: string; label: string; state: SectionState };
export type KeyFact = { key: string; label: string; value: string | null; jump: string | null };
export type NextBestAction = {
  title: string;
  body: string;
  jump: string | null;
  jumpLabel: string | null;
  done: boolean;
};

export type DraftCompletion = {
  requiredItems: CompletionItem[];
  recommendedItems: CompletionItem[];
  requiredTotal: number;
  requiredComplete: number;
  requiredPercent: number;
  recommendedTotal: number;
  recommendedComplete: number;
  recommendedPercent: number;
  missingRequiredItems: CompletionItem[];
  missingRecommendedItems: CompletionItem[];
  publishReady: boolean;
  nextBestAction: NextBestAction;
  nextShortLabel: string;
  sectionStatuses: SectionStatus[];
  keyFacts: KeyFact[];
  statusLabel: string;
  statusKind: DraftStatusKind;
};

const percent = (done: number, total: number) => (total === 0 ? 100 : Math.round((done / total) * 100));
const isSpecificExperience = (value?: string | null) => Boolean(value && value.trim() && value.trim().toLowerCase() !== "any");
const normalized = (value?: string | null) => (value || "").trim().toLowerCase();
const fallbackTitlePattern = /^untitled\s+(job|talent)(\s+(draft|listing))?(\s+copy)?$/i;

export function isFallbackDraftTitle(value?: string | null): boolean {
  return fallbackTitlePattern.test((value || "").trim());
}

function hasActualTitle(value?: string | null, metaValue?: boolean): boolean {
  if (metaValue === false) return false;
  const title = (value || "").trim();
  if (title.length < 3) return false;
  if (isFallbackDraftTitle(title)) return false;
  return metaValue ?? true;
}

function hasActualBudget(job: Partial<Job>): boolean {
  if (job.draftCompletion?.hasBudget === false) return false;
  if (job.draftCompletion?.hasBudget === true) return true;
  const budget = normalized(job.budget);
  if (!budget || budget === "flexible") return false;
  return true;
}

function hasActualPlatform(job: Partial<Job>): boolean {
  if (job.draftCompletion?.hasPlatform === false) return false;
  if (job.draftCompletion?.hasPlatform === true) return true;
  return truthy(job.platform);
}

function hasActualWorkMode(job: Partial<Job>): boolean {
  if (job.draftCompletion?.hasWorkMode === false) return false;
  if (job.draftCompletion?.hasWorkMode === true) return true;
  return truthy(job.workMode);
}

function hasActualHiringChannel(job: Partial<Job>): boolean {
  if (job.draftCompletion?.hasChannel === false) return false;
  if (job.draftCompletion?.hasChannel === true) return true;
  return Boolean(job.hiringIdentityId || truthy(job.hiringDisplayName) || truthy(job.channel?.name));
}

function hasActualTimeline(job: Partial<Job>, fallback: boolean): boolean {
  if (job.draftCompletion?.hasTimeline === false) return false;
  if (job.draftCompletion?.hasTimeline === true) return true;
  return fallback;
}

function normalizeItem(item: CompletionItemInput): CompletionItem {
  const complete = item.complete ?? item.done;
  const type = item.type ?? (item.required ? "required" : "recommended");
  const labelIsAction = /^(add|verify|attach|describe)\b/i.test(item.label);
  const actionLabel =
    item.actionLabel ?? (labelIsAction ? item.label : item.key === "access" ? "Verify channel access" : `Add ${item.label.toLowerCase()}`);
  return {
    ...item,
    id: item.id ?? item.key,
    complete,
    done: complete,
    type,
    required: type === "required",
    target: item.target ?? item.jump,
    jump: item.jump,
    actionLabel,
  };
}

function shortAction(item: CompletionItem): string {
  return item.actionLabel;
}

function jumpLabel(item: CompletionItem): string {
  return item.actionLabel
    .replace(/^(add|verify|attach|describe)\s+/i, "")
    .trim()
    .toLowerCase();
}

function build(
  rawItems: CompletionItemInput[],
  groups: Array<{ key: string; label: string }>,
  keyFacts: KeyFact[]
): DraftCompletion {
  const items = rawItems.map(normalizeItem);
  const requiredItems = items.filter((i) => i.required);
  const recommendedItems = items.filter((i) => !i.required);
  const requiredComplete = requiredItems.filter((i) => i.done).length;
  const recommendedComplete = recommendedItems.filter((i) => i.done).length;
  const missingRequiredItems = requiredItems.filter((i) => !i.done);
  const missingRecommendedItems = recommendedItems.filter((i) => !i.done);
  const publishReady = missingRequiredItems.length === 0;

  const sectionStatuses: SectionStatus[] = groups.map((group) => {
    const groupItems = items.filter((i) => i.group === group.key);
    const anyDone = groupItems.some((i) => i.done);
    const requiredMissing = groupItems.some((i) => i.required && !i.done);
    const recommendedMissing = groupItems.some((i) => !i.required && !i.done);
    let state: SectionState;
    if (groupItems.length === 0 || !anyDone) state = "not-started";
    else if (requiredMissing) state = "needs-action";
    else if (recommendedMissing) state = "publish-ready";
    else state = "complete";
    return { key: group.key, label: group.label, state };
  });

  let nextBestAction: NextBestAction;
  if (missingRequiredItems.length > 0) {
    const first = missingRequiredItems[0];
    nextBestAction = {
      title: first.actionLabel,
      body: "This is the next required detail.",
      jump: first.target,
      jumpLabel: jumpLabel(first),
      done: false,
    };
  } else if (missingRecommendedItems.length > 0) {
    const first = missingRecommendedItems[0];
    nextBestAction = {
      title: first.actionLabel,
      body: first.helpText || "This can improve listing strength.",
      jump: first.target,
      jumpLabel: jumpLabel(first),
      done: false,
    };
  } else {
    nextBestAction = {
      title: "Review and publish",
      body: "This draft is ready.",
      jump: null,
      jumpLabel: null,
      done: true,
    };
  }

  const nextShortLabel =
    missingRequiredItems.length > 0
      ? shortAction(missingRequiredItems[0])
      : missingRecommendedItems.length > 0
        ? shortAction(missingRecommendedItems[0])
        : "Ready to publish";

  const anyDataAtAll = items.some((i) => i.done);
  let statusKind: DraftStatusKind;
  let statusLabel: string;
  if (!anyDataAtAll) {
    statusKind = "not_started";
    statusLabel = "Not started";
  } else if (missingRequiredItems.length > 0) {
    const onlyAccess = missingRequiredItems.every((i) => i.key === "access");
    if (onlyAccess) {
      statusKind = "needs_verification";
      statusLabel = "Needs verification";
    } else {
      statusKind = "needs_action";
      statusLabel = `Missing ${missingRequiredItems.length} required`;
    }
  } else {
    statusKind = "ready";
    statusLabel = "Ready to publish";
  }

  return {
    requiredItems,
    recommendedItems,
    requiredTotal: requiredItems.length,
    requiredComplete,
    requiredPercent: percent(requiredComplete, requiredItems.length),
    recommendedTotal: recommendedItems.length,
    recommendedComplete,
    recommendedPercent: percent(recommendedComplete, recommendedItems.length),
    missingRequiredItems,
    missingRecommendedItems,
    publishReady,
    nextBestAction,
    nextShortLabel,
    sectionStatuses,
    keyFacts,
    statusLabel,
    statusKind,
  };
}

const truthy = (value?: string | null) => Boolean(value && value.trim());

/** Publish readiness + listing strength for a job draft. Mirrors PostJobPage validation. */
export function getJobDraftCompletion(job: Partial<Job>): DraftCompletion {
  const title = (job.title || "").trim();
  const hasTitle = hasActualTitle(title, job.draftCompletion?.hasTitle);
  const hasChannel = hasActualHiringChannel(job);
  const verification = (job.hiringVerificationStatus || "").toUpperCase();
  const workMode = (job.workMode || "").toLowerCase();
  const cityRequired = workMode === "hybrid" || workMode === "onsite" || workMode === "on-site";
  const tools = job.tools || [];
  const creatorContextCount = creatorContextFieldCount({
    contentNiches: job.contentNiches,
    contentGenres: job.contentGenres,
    formatsHiredFor: job.formatsHiredFor,
  });
  const hasContentNiches = Boolean(job.contentNiches?.length);
  const hasContentGenres = Boolean(job.contentGenres?.length);
  const hasFormatsHiredFor = Boolean(job.formatsHiredFor?.length);
  const hasRefVideos = Boolean(job.referenceVideos && job.referenceVideos.length > 0);
  const hasTimeline = hasActualTimeline(
    job,
    truthy(job.weeklyHours) || (truthy(job.startTimeframe) && (job.startTimeframe || "").toLowerCase() !== "flexible")
  );
  const hasExperience =
    job.draftCompletion?.hasExperience === true ||
    isSpecificExperience(job.experience) ||
    isSpecificExperience((job as Partial<Job> & { experience_level?: string | null }).experience_level);

  const G = {
    basics: { key: "basics", label: "Basics" },
    context: { key: "context", label: "About the brand" },
    role: { key: "role", label: "Role details" },
    budget: { key: "budget", label: "Budget / compensation" },
    skills: { key: "skills", label: "Skills & tools" },
    creatorContext: { key: "creatorContext", label: "Creator context" },
    location: { key: "location", label: "Location / work mode" },
    timeline: { key: "timeline", label: "Timeline / availability" },
    media: { key: "media", label: "Portfolio / media" },
    verification: { key: "verification", label: "Verification / access" },
  };

  const items: CompletionItemInput[] = [
    {
      key: "title",
      label: "Add title",
      done: hasTitle,
      required: true,
      jump: "basics",
      group: G.basics.key,
      groupLabel: G.basics.label,
    },
    {
      key: "platform",
      label: "Add platform",
      done: hasActualPlatform(job),
      required: true,
      jump: "basics",
      group: G.basics.key,
      groupLabel: G.basics.label,
    },
    {
      key: "budget",
      label: "Add budget",
      done: hasActualBudget(job),
      required: true,
      jump: "budget",
      group: G.budget.key,
      groupLabel: G.budget.label,
    },
    {
      key: "workMode",
      label: "Add work mode",
      done: hasActualWorkMode(job),
      required: true,
      jump: "basics",
      group: G.location.key,
      groupLabel: G.location.label,
    },
    {
      key: "context",
      label: "Add about the brand",
      done: truthy(job.about) && (job.about || "").trim().length >= 20,
      required: true,
      jump: "about",
      group: G.context.key,
      groupLabel: G.context.label,
    },
    {
      key: "channel",
      label: "Add hiring channel",
      done: hasChannel,
      required: true,
      jump: "identity",
      group: G.verification.key,
      groupLabel: G.verification.label,
    },
  ];
  if (cityRequired) {
    items.push({
      key: "location",
      label: "Add location",
      done: truthy(job.location),
      required: true,
      jump: "basics",
      group: G.location.key,
      groupLabel: G.location.label,
    });
  }
  if (job.hiringIdentityId) {
    items.push({
      key: "access",
      label: "Verify channel access",
      done: verification === "VERIFIED",
      required: true,
      jump: "identity",
      group: G.verification.key,
      groupLabel: G.verification.label,
      actionLabel: "Verify channel access",
    });
  }

  items.push(
    {
      key: "responsibilities",
      label: "Add responsibilities",
      done: truthy(job.responsibilities),
      required: false,
      jump: "responsibilities",
      group: G.role.key,
      groupLabel: G.role.label,
    },
    {
      key: "requirements",
      label: "Add requirements",
      done: truthy(job.requirements),
      required: false,
      jump: "requirements",
      group: G.role.key,
      groupLabel: G.role.label,
    },
    {
      key: "tools",
      label: "Add tools expected",
      done: tools.length > 0,
      required: false,
      jump: "tools",
      group: G.skills.key,
      groupLabel: G.skills.label,
      actionLabel: "Add tools expected",
    },
    {
      key: "contentNiches",
      label: "Add content niches",
      done: hasContentNiches,
      required: false,
      jump: "contentNiches",
      group: G.creatorContext.key,
      groupLabel: G.creatorContext.label,
      actionLabel: "Add content niches",
    },
    {
      key: "contentGenres",
      label: "Add genres",
      done: hasContentGenres,
      required: false,
      jump: "contentGenres",
      group: G.creatorContext.key,
      groupLabel: G.creatorContext.label,
      actionLabel: "Add genres",
    },
    {
      key: "formatsHiredFor",
      label: "Add formats hired for",
      done: hasFormatsHiredFor,
      required: false,
      jump: "formatsHiredFor",
      group: G.creatorContext.key,
      groupLabel: G.creatorContext.label,
      actionLabel: "Add formats hired for",
    },
    {
      key: "experience",
      label: "Add experience",
      done: hasExperience,
      required: false,
      jump: "experience",
      group: G.role.key,
      groupLabel: G.role.label,
    },
    {
      key: "timeline",
      label: "Add timeline",
      done: hasTimeline,
      required: false,
      jump: "basics",
      group: G.timeline.key,
      groupLabel: G.timeline.label,
    },
    {
      key: "media",
      label: "Add reference video",
      done: hasRefVideos,
      required: false,
      jump: "media",
      group: G.media.key,
      groupLabel: G.media.label,
    }
  );

  const groups = [G.basics, G.context, G.role, G.budget, G.skills, G.creatorContext, G.location, G.timeline, G.media, G.verification];

  const accessConfirmed = !job.hiringIdentityId || verification === "VERIFIED";
  const accessValue = job.hiringIdentityId
    ? verification === "VERIFIED"
      ? "Confirmed"
      : verification
        ? "Pending"
        : "Not verified"
    : "Not required";

  const keyFacts: KeyFact[] = [
    { key: "type", label: "Type", value: "Job listing", jump: null },
    { key: "workMode", label: "Work mode", value: job.workMode || null, jump: "basics" },
    { key: "budget", label: "Compensation", value: truthy(job.budget) ? (job.budget as string) : null, jump: "budget" },
    { key: "tools", label: "Tools", value: tools.length ? tools.slice(0, 3).join(", ") : null, jump: "tools" },
    {
      key: "creatorContext",
      label: "Creator context",
      value: creatorContextCount ? `${creatorContextCount}/3 fields` : null,
      jump: "creatorContext",
    },
    { key: "location", label: "Location", value: job.location || null, jump: "basics" },
    { key: "timeline", label: "Timeline", value: job.weeklyHours || (hasTimeline ? job.startTimeframe || null : null), jump: "basics" },
    { key: "access", label: "Channel access", value: accessValue, jump: accessConfirmed ? null : "identity" },
  ];

  return build(items, groups, keyFacts);
}

/** Publish readiness + listing strength for a talent draft. Mirrors PostTalentPage validation. */
export function getTalentDraftCompletion(listing: Partial<BackendTalentListing>): DraftCompletion {
  const title = (listing.title || "").trim();
  const hasTitle = hasActualTitle(title);
  const primaryRole = (listing.primary_role || listing.roles?.[0] || "").trim();
  const workMode = (listing.work_mode || "").toLowerCase();
  const cityRequired = workMode === "hybrid" || workMode === "onsite" || workMode === "on-site";
  const hasRate = listing.rate_min != null || listing.rate_max != null || truthy(listing.rate_note);
  const tools = listing.tools || [];
  const platforms = listing.platforms || [];
  const portfolio = listing.portfolio_item_ids || [];
  const creatorContextCount = creatorContextFieldCount({
    contentNiches: listing.content_niches,
    contentGenres: listing.content_genres,
    formatsHiredFor: listing.formats,
  });

  const G = {
    basics: { key: "basics", label: "Basics" },
    services: { key: "services", label: "Services" },
    creatorContext: { key: "creatorContext", label: "Creator context" },
    toolsPortfolio: { key: "toolsPortfolio", label: "Tools & portfolio" },
  };

  const items: CompletionItemInput[] = [
    {
      key: "title",
      label: "Add title",
      done: hasTitle,
      required: true,
      jump: "basics",
      group: G.basics.key,
      groupLabel: G.basics.label,
    },
    {
      key: "role",
      label: "Add primary role",
      done: primaryRole.length >= 2,
      required: true,
      jump: "basics",
      group: G.basics.key,
      groupLabel: G.basics.label,
    },
    {
      key: "workMode",
      label: "Add work mode",
      done: truthy(listing.work_mode),
      required: true,
      jump: "basics",
      group: G.basics.key,
      groupLabel: G.basics.label,
    },
    {
      key: "rate",
      label: "Add rate",
      done: hasRate,
      required: true,
      jump: "basics",
      group: G.basics.key,
      groupLabel: G.basics.label,
    },
  ];
  if (cityRequired) {
    items.push({
      key: "location",
      label: "Add location",
      done: truthy(listing.location),
      required: true,
      jump: "basics",
      group: G.basics.key,
      groupLabel: G.basics.label,
    });
  }

  items.push(
    {
      key: "niche",
      label: "Add platforms",
      done: platforms.length > 0,
      required: false,
      jump: "niche",
      group: G.creatorContext.key,
      groupLabel: G.creatorContext.label,
      actionLabel: "Add platforms",
    },
    {
      key: "creatorContext",
      label: "Add creator context",
      done: isCreatorContextComplete({
        contentNiches: listing.content_niches,
        contentGenres: listing.content_genres,
        formatsHiredFor: listing.formats,
      }),
      required: false,
      jump: "creatorContext",
      group: G.creatorContext.key,
      groupLabel: G.creatorContext.label,
      actionLabel: "Add creator context",
      helpText: "Helps recruiters find you in search.",
    },
    {
      key: "tools",
      label: "Add tools",
      done: tools.length > 0,
      required: false,
      jump: "tools",
      group: G.toolsPortfolio.key,
      groupLabel: G.toolsPortfolio.label,
    },
    {
      key: "portfolio",
      label: "Attach work samples",
      done: portfolio.length > 0,
      required: false,
      jump: "portfolio",
      group: G.toolsPortfolio.key,
      groupLabel: G.toolsPortfolio.label,
    },
    {
      key: "description",
      label: "Describe your services",
      done: truthy(listing.description),
      required: false,
      jump: "description",
      group: G.services.key,
      groupLabel: G.services.label,
    },
    {
      key: "experience",
      label: "Add years of experience",
      // Talent experience is now exact whole years (0 = "less than 1 year" still counts);
      // legacy range/level strings no longer count.
      done: typeof listing.experience_years === "number" && listing.experience_years >= 0,
      required: false,
      jump: "experience",
      group: G.basics.key,
      groupLabel: G.basics.label,
    }
  );

  const groups = [G.basics, G.services, G.creatorContext, G.toolsPortfolio];

  const rateValue = hasRate
    ? truthy(listing.rate_note)
      ? (listing.rate_note as string)
      : [listing.rate_min, listing.rate_max].filter((v) => v != null).join("–") || "Provided"
    : null;

  const keyFacts: KeyFact[] = [
    { key: "type", label: "Type", value: "Talent listing", jump: null },
    { key: "role", label: "Primary role", value: primaryRole || null, jump: "basics" },
    { key: "workMode", label: "Work mode", value: listing.work_mode || null, jump: "basics" },
    { key: "rate", label: "Rate", value: rateValue, jump: "basics" },
    {
      key: "creatorContext",
      label: "Creator context",
      value: creatorContextCount ? `${creatorContextCount}/3 fields` : null,
      jump: "creatorContext",
    },
    { key: "tools", label: "Tools", value: tools.length ? tools.slice(0, 3).join(", ") : null, jump: "tools" },
    { key: "portfolio", label: "Portfolio", value: portfolio.length ? `${portfolio.length} sample${portfolio.length > 1 ? "s" : ""}` : null, jump: "portfolio" },
  ];

  return build(items, groups, keyFacts);
}

// ---- Inline draft title editing ----

export const DRAFT_TITLE_MIN_LENGTH = 3;
export const DRAFT_TITLE_MAX_LENGTH = 94;

export type DraftTitleValidation = { ok: true; title: string } | { ok: false; error: string };

/**
 * Title rule shared with the post-job / post-talent flows: trimmed and at least
 * 3 characters. An empty string is never accepted as a real title.
 */
export function validateDraftTitle(raw: string): DraftTitleValidation {
  const title = raw.trim();
  if (!title) return { ok: false, error: "Add a title to save." };
  if (title.length < DRAFT_TITLE_MIN_LENGTH) return { ok: false, error: "Use at least 3 characters." };
  return { ok: true, title };
}

/**
 * Returns a copy of `item` with `rawTitle` applied to the underlying draft
 * source and the completion model recomputed, so publish readiness, the
 * "Add title" task, and the next best action all reflect the new title. Every
 * other field (resume target, draft status, id, etc.) is preserved — no
 * duplicate is created and the status stays "draft".
 */
export function applyDraftTitle(item: DraftItem, rawTitle: string): DraftItem {
  const title = rawTitle.trim();
  const isRealTitle = title.length >= DRAFT_TITLE_MIN_LENGTH && !isFallbackDraftTitle(title);
  if (item.kind === "job") {
    const sourceJob: Partial<Job> = {
      ...(item.sourceJob || {}),
      title,
      draftCompletion: { ...(item.sourceJob?.draftCompletion || {}), hasTitle: isRealTitle },
    };
    return { ...item, title, untitled: !isRealTitle, completion: getJobDraftCompletion(sourceJob), sourceJob };
  }
  const sourceTalent: Partial<BackendTalentListing> = { ...(item.sourceTalent || {}), title };
  return { ...item, title, untitled: !isRealTitle, completion: getTalentDraftCompletion(sourceTalent), sourceTalent };
}
