// First-message requirements registry.
//
// A listing owner (recruiter posting a job, or talent posting a listing) chooses
// which structured details the *other* side must attach with their opening message.
// This single registry drives every surface: the owner's selection UI, the
// applicant/requester completion form, validation, what gets stored, and how the
// inbox renders the opening-message summary. Adding or changing a requirement here
// updates all of those workflows at once — do not scatter this logic elsewhere.

export type RequirementContext = "job" | "talent";

// How an answer is captured + rendered. Each type has exactly one field renderer
// (see components/first-message/FirstMessageFields.tsx) and one summary renderer
// (FirstMessageSummary.tsx), so the experience stays consistent everywhere.
export type RequirementAnswerType =
  | "text"
  | "longText"
  | "currency"
  | "portfolio"
  | "link"
  | "multiLink"
  | "select"
  | "startDate"
  | "availability"
  | "turnaround"
  | "tools"
  | "experience";

// Subset of the app's Icon names used by requirements. A subset union stays
// assignable to the Icon component's full union, so tsc is happy.
export type RequirementIcon =
  | "cash"
  | "indian-rupee"
  | "cash-stack"
  | "image"
  | "images"
  | "clock"
  | "timer-reset"
  | "calendar-clock"
  | "calendar-check"
  | "bolt"
  | "cap"
  | "badge-check"
  | "settings"
  | "sliders-horizontal"
  | "circle-play"
  | "pencil"
  | "message-square-text"
  | "message-square-plus"
  | "file"
  | "external-link";

// Context-specific copy. Job and talent contexts deliberately differ in wording
// (e.g. "Expected rate" for an applicant vs "Project budget" for a recruiter).
export type RequirementCopy = {
  /** Title on the owner's selectable card. */
  owner: string;
  /** One-line helper under the owner's card title. */
  ownerHint: string;
  /** Field label shown to the applicant / requester. */
  requester: string;
  /** Placeholder / inline guidance for the completion field. */
  placeholder?: string;
  /** Compact label used in the inbox opening-message summary. */
  summary: string;
  /** Units offered for currency answers in this context. */
  units?: string[];
  /** Quick-pick suggestions for availability answers in this context. */
  suggestions?: string[];
  /** Options for select answers in this context. */
  options?: string[];
};

export type RequirementDef = {
  key: string;
  answerType: RequirementAnswerType;
  icon: RequirementIcon;
  /** Present when the requirement applies to job applications. */
  job?: RequirementCopy;
  /** Present when the requirement applies to talent hiring requests. */
  talent?: RequirementCopy;
};

export const CUSTOM_INSTRUCTION_REQUIREMENT_KEY = "custom_instruction";

// ── Structured answer value shapes ─────────────────────────────────────────────
export type CurrencyAnswer = { amount: string; unit: string };
export type TurnaroundAnswer = { value: string; unit: "hours" | "days" | "weeks" };
export type PortfolioRef = { id: string; title: string; url?: string };
export type OpeningMessageAttachment = { label: string; url?: string | null };
export type CustomInstructionAnswer = {
  prompt?: string;
  response: string;
  links?: string[];
};

export type RequirementAnswerValue =
  | string
  | string[]
  | CurrencyAnswer
  | TurnaroundAnswer
  | PortfolioRef[]
  | CustomInstructionAnswer;

export type FirstMessageAnswers = Record<string, RequirementAnswerValue>;

// The registry. Order here is the order shown to owners and applicants.
export const FIRST_MESSAGE_REQUIREMENTS: RequirementDef[] = [
  {
    key: "expected_rate",
    answerType: "currency",
    icon: "indian-rupee",
    job: {
      owner: "Expected rate",
      ownerHint: "Rate they’d charge.",
      requester: "Expected rate",
      summary: "Expected rate",
      units: ["per video", "per project", "per month", "per hour"],
    },
  },
  {
    key: "project_budget",
    answerType: "currency",
    icon: "cash-stack",
    talent: {
      owner: "Project budget",
      ownerHint: "Recruiters share the budget they’re working with.",
      requester: "Project budget",
      summary: "Budget",
      units: ["per month", "per project", "per video", "total"],
    },
  },
  {
    key: "relevant_portfolio",
    answerType: "portfolio",
    icon: "images",
    job: {
      owner: "Relevant portfolio",
      ownerHint: "Matching work from their profile.",
      requester: "Relevant portfolio",
      placeholder: "Pick the work that best matches this role.",
      summary: "Portfolio",
    },
  },
  {
    key: "project_brief",
    answerType: "longText",
    icon: "file",
    talent: {
      owner: "Project brief",
      ownerHint: "Recruiters outline the scope of the work.",
      requester: "Project brief",
      placeholder: "Scope, deliverables, volume (e.g. 15 Shorts/month), and goals.",
      summary: "Scope",
    },
  },
  {
    key: "turnaround",
    answerType: "turnaround",
    icon: "timer-reset",
    job: {
      owner: "Turnaround time",
      ownerHint: "How fast they can deliver.",
      requester: "Turnaround time",
      summary: "Turnaround",
    },
    talent: {
      owner: "Expected turnaround",
      ownerHint: "Recruiters share the delivery cadence they need.",
      requester: "Expected turnaround",
      summary: "Turnaround",
    },
  },
  {
    key: "working_hours",
    answerType: "availability",
    icon: "calendar-clock",
    job: {
      owner: "Working hours",
      ownerHint: "Availability or overlap.",
      requester: "Working hours",
      placeholder: "e.g. Evenings, 6–10pm IST",
      summary: "Working hours",
      suggestions: ["Evenings IST", "Mornings IST", "Flexible hours", "Full-time overlap"],
    },
    talent: {
      owner: "Working hours / schedule",
      ownerHint: "Recruiters share the schedule they expect.",
      requester: "Working hours / schedule",
      placeholder: "e.g. Weekly delivery, evenings IST",
      summary: "Working hours",
      suggestions: ["Evenings IST", "Mornings IST", "Flexible hours", "Weekly delivery"],
    },
  },
  {
    key: "relevant_experience",
    answerType: "experience",
    icon: "badge-check",
    job: {
      owner: "Relevant experience",
      ownerHint: "Directly related background.",
      requester: "Relevant experience",
      placeholder: "e.g. Edited finance explainers for 2 YouTube channels over 3 years.",
      summary: "Experience",
    },
  },
  {
    key: "tools_workflow",
    answerType: "tools",
    icon: "sliders-horizontal",
    job: {
      owner: "Tools / workflow",
      ownerHint: "Tools they work with.",
      requester: "Tools / workflow",
      placeholder: "Premiere Pro, After Effects, CapCut…",
      summary: "Tools",
    },
  },
  {
    key: "channel_or_brand_link",
    answerType: "link",
    icon: "external-link",
    talent: {
      owner: "Channel or brand link",
      ownerHint: "Recruiters share the channel/brand they’re hiring for.",
      requester: "Channel or brand link",
      placeholder: "https://youtube.com/@yourchannel",
      summary: "Channel",
    },
  },
  {
    key: "reference_links",
    answerType: "multiLink",
    icon: "external-link",
    talent: {
      owner: "Reference links",
      ownerHint: "Recruiters share references for the style they want.",
      requester: "Reference links",
      placeholder: "https://…",
      summary: "References",
    },
  },
  {
    key: "start_availability",
    answerType: "startDate",
    icon: "calendar-check",
    job: {
      owner: "Start availability",
      ownerHint: "When they can begin.",
      requester: "Start availability",
      summary: "Start",
      suggestions: ["Immediately", "Within 1 week", "Within 2 weeks", "Flexible"],
    },
    talent: {
      owner: "Start availability",
      ownerHint: "Recruiters share when the work would begin.",
      requester: "Start availability",
      summary: "Start",
      suggestions: ["Immediately", "Within 1 week", "Within 2 weeks", "Flexible"],
    },
  },
  {
    key: "fit_note",
    answerType: "longText",
    icon: "message-square-text",
    job: {
      owner: "Fit note",
      ownerHint: "Why they’re a fit.",
      requester: "Fit note",
      placeholder: "Why you’re a strong fit for this role.",
      summary: "Fit note",
    },
    talent: {
      owner: "Fit note",
      ownerHint: "A short note on why they’re reaching out.",
      requester: "Fit note",
      placeholder: "Why you’re reaching out and what you’re looking for.",
      summary: "Fit note",
    },
  },
  {
    key: CUSTOM_INSTRUCTION_REQUIREMENT_KEY,
    answerType: "longText",
    icon: "message-square-plus",
    job: {
      owner: "Custom instruction",
      ownerHint: "Ask for something specific.",
      requester: "Custom instruction",
      placeholder: "Respond to the custom instruction from this listing.",
      summary: "Custom instruction",
    },
    talent: {
      owner: "Custom instruction",
      ownerHint: "Ask for something specific.",
      requester: "Custom instruction",
      placeholder: "Respond to the custom instruction from this listing.",
      summary: "Custom instruction",
    },
  },
];

const REQUIREMENT_BY_KEY: Record<string, RequirementDef> = Object.fromEntries(
  FIRST_MESSAGE_REQUIREMENTS.map((def) => [def.key, def])
);

// ── Lookups ────────────────────────────────────────────────────────────────────
export function getRequirementDef(key: string): RequirementDef | undefined {
  return REQUIREMENT_BY_KEY[key];
}

/** Requirements selectable in a given context, in registry order. */
export function requirementsForContext(context: RequirementContext): RequirementDef[] {
  return FIRST_MESSAGE_REQUIREMENTS.filter((def) => Boolean(def[context]));
}

/** Resolve a requirement's context-specific copy. */
export function requirementCopy(
  def: RequirementDef,
  context: RequirementContext
): RequirementCopy | null {
  return def[context] ?? null;
}

/** Keep only keys that are real, selectable requirements for the context. */
export function sanitizeRequirementKeys(
  keys: readonly string[] | null | undefined,
  context: RequirementContext
): string[] {
  if (!keys) return [];
  const allowed = new Set(requirementsForContext(context).map((d) => d.key));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of keys) {
    if (allowed.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  // Preserve registry order for stable rendering.
  return requirementsForContext(context)
    .map((d) => d.key)
    .filter((k) => out.includes(k));
}

// ── Type guards ─────────────────────────────────────────────────────────────────
export function isCurrencyAnswer(value: unknown): value is CurrencyAnswer {
  return Boolean(value) && typeof value === "object" && "amount" in (value as object);
}
export function isTurnaroundAnswer(value: unknown): value is TurnaroundAnswer {
  return Boolean(value) && typeof value === "object" && "value" in (value as object) && "unit" in (value as object);
}
export function isPortfolioAnswer(value: unknown): value is PortfolioRef[] {
  return Array.isArray(value) && value.every((v) => v && typeof v === "object" && "id" in v);
}
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}
export function isCustomInstructionAnswer(value: unknown): value is CustomInstructionAnswer {
  return Boolean(value) && typeof value === "object" && "response" in (value as object);
}

function comparableText(value: string | null | undefined): string {
  return (value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function comparableUrl(value: string | null | undefined): string {
  return (value || "").trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * Legacy opening-message attachments and structured `relevant_portfolio` answers
 * can carry the same portfolio links. Render the structured answer once and keep
 * only attachments that are not already represented there.
 */
export function filterStructuredPortfolioDuplicateAttachments<T extends OpeningMessageAttachment>(
  attachments: readonly T[] | null | undefined,
  answers: FirstMessageAnswers | null | undefined
): T[] {
  if (!attachments?.length) return [];
  const portfolio = answers?.relevant_portfolio;
  if (!isPortfolioAnswer(portfolio) || portfolio.length === 0) return [...attachments];

  const portfolioUrls = new Set(portfolio.map((item) => comparableUrl(item.url)).filter(Boolean));
  const portfolioLabels = new Set(portfolio.map((item) => comparableText(item.title)).filter(Boolean));

  return attachments.filter((attachment) => {
    const url = comparableUrl(attachment.url);
    if (url && portfolioUrls.has(url)) return false;

    const label = comparableText(attachment.label);
    if (label && portfolioLabels.has(label)) return false;

    return true;
  });
}

// ── Validation ──────────────────────────────────────────────────────────────────
const URL_RE = /^https?:\/\/[^\s.]+\.[^\s]{2,}$/i;

export function isValidUrl(value: string): boolean {
  return URL_RE.test(value.trim());
}

/** True when a single requirement has a complete, valid answer. */
export function isAnswerComplete(def: RequirementDef, value: RequirementAnswerValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (def.key === CUSTOM_INSTRUCTION_REQUIREMENT_KEY) {
    if (typeof value === "string") return value.trim().length > 0;
    if (!isCustomInstructionAnswer(value)) return false;
    const links = (value.links || []).map((l) => l.trim()).filter(Boolean);
    return value.response.trim().length > 0 && links.every(isValidUrl);
  }
  switch (def.answerType) {
    case "currency":
      return isCurrencyAnswer(value) && value.amount.trim().length > 0;
    case "turnaround":
      return isTurnaroundAnswer(value) && value.value.trim().length > 0;
    case "portfolio":
      return isPortfolioAnswer(value) && value.length > 0;
    case "multiLink": {
      if (!isStringArray(value)) return false;
      const links = value.map((l) => l.trim()).filter(Boolean);
      return links.length > 0 && links.every(isValidUrl);
    }
    case "tools":
      return isStringArray(value) && value.filter((t) => t.trim()).length > 0;
    case "link":
      return typeof value === "string" && isValidUrl(value);
    default:
      return typeof value === "string" && value.trim().length > 0;
  }
}

/** Per-key error messages for the requirements still missing/invalid. Empty = ok. */
export function validateAnswers(
  requirementKeys: readonly string[],
  context: RequirementContext,
  answers: FirstMessageAnswers
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const key of sanitizeRequirementKeys(requirementKeys, context)) {
    const def = getRequirementDef(key);
    if (!def) continue;
    const value = answers[key];
    if (isAnswerComplete(def, value)) continue;
    const copy = requirementCopy(def, context);
    const label = copy?.requester ?? def.key;
    if (def.answerType === "link" && typeof value === "string" && value.trim()) {
      errors[key] = "Enter a valid link.";
    } else if (def.answerType === "multiLink") {
      errors[key] = "Add at least one valid link.";
    } else if (key === CUSTOM_INSTRUCTION_REQUIREMENT_KEY && isCustomInstructionAnswer(value)) {
      const links = (value.links || []).map((link) => link.trim()).filter(Boolean);
      errors[key] = links.some((link) => !isValidUrl(link)) ? "Use valid links, or remove them." : "Answer this prompt.";
    } else if (def.answerType === "portfolio") {
      errors[key] = "Select at least one item.";
    } else {
      errors[key] = `${label} is required.`;
    }
  }
  return errors;
}

export function answersComplete(
  requirementKeys: readonly string[],
  context: RequirementContext,
  answers: FirstMessageAnswers
): boolean {
  return Object.keys(validateAnswers(requirementKeys, context, answers)).length === 0;
}

export function normalizeFirstMessageAnswers(
  requirementKeys: readonly string[],
  context: RequirementContext,
  answers: FirstMessageAnswers,
  prompts?: Record<string, string>
): FirstMessageAnswers {
  const normalized: FirstMessageAnswers = {};
  for (const key of sanitizeRequirementKeys(requirementKeys, context)) {
    const def = getRequirementDef(key);
    if (!def || !(key in answers)) continue;
    const value = answers[key];
    if (key === CUSTOM_INSTRUCTION_REQUIREMENT_KEY) {
      const prompt =
        (isCustomInstructionAnswer(value) ? value.prompt?.trim() : "") ||
        prompts?.[key]?.trim() ||
        "";
      const response =
        typeof value === "string"
          ? value.trim()
          : isCustomInstructionAnswer(value)
            ? value.response.trim()
            : "";
      const links = isCustomInstructionAnswer(value)
        ? (value.links || []).map((link) => link.trim()).filter(Boolean)
        : [];
      normalized[key] = {
        ...(prompt ? { prompt } : {}),
        response,
        ...(links.length ? { links } : { links: [] }),
      } satisfies CustomInstructionAnswer;
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

// ── Display formatting (inbox summary + plain-text body) ─────────────────────────
export type RequirementSummaryItem = {
  key: string;
  icon: RequirementIcon;
  label: string;
  /** Single-line value for compact display, when applicable. */
  text?: string;
  /** Link/portfolio values for richer rendering. */
  links?: { id?: string; label: string; url?: string; kind?: "portfolio" | "link" }[];
  /** Headline value (e.g. the rate) shown without a label, since it reads on its own. */
  emphasis?: boolean;
};

function formatCurrency(value: CurrencyAnswer): string {
  const amount = value.amount.trim();
  if (!amount) return "";
  const withSymbol = /^[₹$€£]/.test(amount) ? amount : `₹${amount}`;
  return value.unit ? `${withSymbol} ${value.unit}` : withSymbol;
}

function formatTurnaround(value: TurnaroundAnswer): string {
  const v = value.value.trim();
  if (!v) return "";
  const unit = Number(v) === 1 ? value.unit.replace(/s$/, "") : value.unit;
  return `${v} ${unit}`;
}

/** Build a structured, render-ready summary of the answers for the inbox. */
export function summarizeAnswers(
  requirementKeys: readonly string[],
  context: RequirementContext,
  answers: FirstMessageAnswers
): RequirementSummaryItem[] {
  const items: RequirementSummaryItem[] = [];
  for (const key of sanitizeRequirementKeys(requirementKeys, context)) {
    const def = getRequirementDef(key);
    const copy = def ? requirementCopy(def, context) : null;
    if (!def || !copy) continue;
    const value = answers[key];
    if (value === undefined || value === null) continue;

    const base = { key, icon: def.icon, label: copy.summary };

    if (def.answerType === "currency" && isCurrencyAnswer(value)) {
      const text = formatCurrency(value);
      if (text) items.push({ ...base, text, emphasis: true });
    } else if (def.answerType === "turnaround" && isTurnaroundAnswer(value)) {
      const text = formatTurnaround(value);
      if (text) items.push({ ...base, text });
    } else if (def.answerType === "portfolio" && isPortfolioAnswer(value)) {
      const links = value.map((p) => ({
        id: p.id,
        label: p.title || "Portfolio item",
        url: p.url,
        kind: "portfolio" as const,
      }));
      if (links.length) {
        items.push({
          ...base,
          links,
        });
      }
    } else if (def.answerType === "multiLink" && isStringArray(value)) {
      const links = value.map((l) => l.trim()).filter(Boolean).map((url) => ({ label: prettyLinkLabel(url), url }));
      if (links.length) items.push({ ...base, text: `${links.length} link${links.length === 1 ? "" : "s"}`, links });
    } else if (def.answerType === "link" && typeof value === "string" && value.trim()) {
      items.push({ ...base, links: [{ label: prettyLinkLabel(value), url: value.trim() }] });
    } else if (def.answerType === "tools" && isStringArray(value)) {
      const tools = value.map((t) => t.trim()).filter(Boolean);
      if (tools.length) items.push({ ...base, text: tools.join(", ") });
    } else if (key === CUSTOM_INSTRUCTION_REQUIREMENT_KEY && isCustomInstructionAnswer(value)) {
      const text = value.response.trim();
      const prompt = value.prompt?.trim();
      const links = (value.links || [])
        .map((l) => l.trim())
        .filter(Boolean)
        .map((url) => ({ label: prettyLinkLabel(url), url }));
      if (text || links.length) {
        items.push({
          ...base,
          label: prompt || base.label,
          text,
          links: links.length ? links : undefined,
        });
      }
    } else if (typeof value === "string" && value.trim()) {
      items.push({ ...base, text: value.trim() });
    }
  }
  return items;
}

function prettyLinkLabel(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "") + (u.pathname !== "/" ? u.pathname : "");
  } catch {
    return url;
  }
}

/** Plain-text rendering of the answers, for systems that only carry a message body. */
export function summarizeAnswersText(
  requirementKeys: readonly string[],
  context: RequirementContext,
  answers: FirstMessageAnswers
): string {
  return summarizeAnswers(requirementKeys, context, answers)
    .map((item) => {
      const value = item.text ?? (item.links ? item.links.map((l) => l.url || l.label).join(", ") : "");
      return `${item.label}: ${value}`;
    })
    .join("\n");
}

/** A blank answer value appropriate for a requirement's answer type. */
export function emptyAnswerFor(def: RequirementDef, context: RequirementContext): RequirementAnswerValue {
  if (def.key === CUSTOM_INSTRUCTION_REQUIREMENT_KEY) {
    return { response: "", links: [] } satisfies CustomInstructionAnswer;
  }
  switch (def.answerType) {
    case "currency": {
      const units = requirementCopy(def, context)?.units;
      return { amount: "", unit: units?.[0] ?? "" } satisfies CurrencyAnswer;
    }
    case "turnaround":
      return { value: "", unit: "days" } satisfies TurnaroundAnswer;
    case "portfolio":
      return [] as PortfolioRef[];
    case "multiLink":
    case "tools":
      return [] as string[];
    default:
      return "";
  }
}
