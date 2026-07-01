/**
 * Opening-message generation for the inbox.
 *
 * Applications and hiring requests *are* the conversation — the application /
 * interest record carries the opening message. When a requester only fills the
 * required first-message details, the message body would otherwise be empty and
 * the inbox would show requirement chips hanging off a blank bubble. These pure
 * helpers produce a natural opening line so the bubble never looks empty:
 *
 *   • If a required `fit_note` was provided, the fit note *is* the message.
 *   • Otherwise a short, human default is generated, personalised with the
 *     channel / talent name when one is available, and rotated deterministically
 *     from a small set so it's varied across conversations but stable per record.
 *
 * The default is chosen once (at submit time, stored as the body) and the inbox
 * only regenerates one defensively for legacy records that arrive blank.
 */

export type OpeningMessageContext = "job" | "talent";

// Job application defaults — read as "I want to work for {channelName}".
const JOB_TEMPLATES_WITH_CHANNEL = [
  "Hi, I came across the listing and would love to work for {channelName}.",
  "Hi, this looks like a good fit. I'd be glad to help with work for {channelName}.",
  "Hi, I'm interested in this role and would like to be considered for work with {channelName}.",
  "Hi, I'd be happy to help with the work you're hiring for at {channelName}.",
  "Hi, I came across the role and think I could be a good fit for {channelName}.",
];

const JOB_TEMPLATES_FALLBACK = [
  "Hi, I came across the listing and would love to be considered.",
  "Hi, this looks like a good fit. I'd be glad to help with the work.",
  "Hi, I'm interested in this role and would like to be considered.",
  "Hi, I'd be happy to help with the work you're hiring for.",
  "Hi, I came across the role and think I could be a good fit.",
];

// Hiring request defaults — read as "Hi {talentName}, I'd like to hire you".
const TALENT_TEMPLATES_WITH_NAME = [
  "Hi {talentName}, I came across your listing and would like to discuss working with you.",
  "Hi {talentName}, your listing looks relevant for what we need. I'd like to talk about working together.",
  "Hi {talentName}, I liked your listing and would be interested in hiring you.",
  "Hi {talentName}, I think your work could be a good fit for what we're looking for.",
  "Hi {talentName}, I came across your profile and would like to explore working together.",
];

const TALENT_TEMPLATES_FALLBACK = [
  "Hi, I came across your listing and would like to discuss working with you.",
  "Hi, your listing looks relevant for what we need. I'd like to talk about working together.",
  "Hi, I liked your listing and would be interested in hiring you.",
  "Hi, I think your work could be a good fit for what we're looking for.",
  "Hi, I came across your profile and would like to explore working together.",
];

// Generic placeholders that upstream code substitutes for a missing name. These
// aren't real names, so we treat them as "no name" and use the fallback copy
// rather than greeting someone as "Content creator" or "Talent".
const GENERIC_NAMES = new Set(["content creator", "talent", "talent profile", "recruiter", "applicant"]);

/** Trim a candidate name, dropping empty values and generic placeholders. */
function cleanName(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;
  return GENERIC_NAMES.has(trimmed.toLowerCase()) ? null : trimmed;
}

/**
 * Deterministic, non-negative string hash (djb2). The same seed always maps to
 * the same number, so a conversation keeps the same default across re-renders —
 * no flicker, no re-randomising.
 */
export function stableHash(seed: string): number {
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 33) ^ seed.charCodeAt(i);
  }
  return hash >>> 0;
}

/** Pick a template by stable hash of the seed so the choice is varied but fixed. */
export function selectOpeningMessageTemplate(templates: readonly string[], seed: string): string {
  if (!templates.length) return "";
  return templates[stableHash(seed) % templates.length];
}

/**
 * The channel/brand a job is hiring for — the same name the job card renders
 * (`JobCard` shows `job.channel.name` via `ChannelAttribution`). We read that
 * first, then a few nested/top-level aliases defensively so a differently-shaped
 * job object (backend snapshot, alternate mapper) still resolves the visible
 * name rather than falling back.
 *
 * The agency, when one posts on a channel's behalf, is carried separately
 * (`managedByAgencyName` / `agency*`) and is never used here. `hiringDisplayName`
 * is only trusted for self-posted listings, where it can't be an agency. Returns
 * null only when no channel name can be confidently identified.
 */
export function resolveJobChannelName(
  job:
    | {
        channel?: { name?: string | null; title?: string | null; displayName?: string | null } | null;
        channelName?: string | null;
        channelTitle?: string | null;
        channelDisplayName?: string | null;
        hiringDisplayName?: string | null;
        postedByAgency?: boolean | null;
      }
    | null
    | undefined
): string | null {
  // Same source the job card renders, then nested/top-level aliases. None of
  // these is an agency field, so the agency name can never surface through them.
  const cardCandidates = [
    job?.channel?.name,
    job?.channel?.title,
    job?.channel?.displayName,
    job?.channelName,
    job?.channelTitle,
    job?.channelDisplayName,
  ];
  for (const candidate of cardCandidates) {
    const name = cleanName(candidate);
    if (name) return name;
  }
  // Self-posted listings can fall back to the hiring display name; agency-posted
  // ones cannot (it may be the agency).
  if (!job?.postedByAgency) {
    const display = cleanName(job?.hiringDisplayName);
    if (display) return display;
  }
  return null;
}

/** The talent's display name, preferring an explicit name over a username. */
export function resolveTalentDisplayName(
  talent:
    | { owner_display_name?: string | null; name?: string | null; owner_username?: string | null }
    | null
    | undefined
): string | null {
  return (
    cleanName(talent?.owner_display_name) ?? cleanName(talent?.name) ?? cleanName(talent?.owner_username)
  );
}

/** Default opening line for a job application, personalised with the channel. */
export function getDefaultApplicationOpeningMessage(
  channelName: string | null | undefined,
  seed: string
): string {
  const name = cleanName(channelName);
  return name
    ? selectOpeningMessageTemplate(JOB_TEMPLATES_WITH_CHANNEL, seed).replace("{channelName}", name)
    : selectOpeningMessageTemplate(JOB_TEMPLATES_FALLBACK, seed);
}

/** Default opening line for a hiring request, personalised with the talent name. */
export function getDefaultHiringRequestOpeningMessage(
  talentName: string | null | undefined,
  seed: string
): string {
  const name = cleanName(talentName);
  return name
    ? selectOpeningMessageTemplate(TALENT_TEMPLATES_WITH_NAME, seed).replace("{talentName}", name)
    : selectOpeningMessageTemplate(TALENT_TEMPLATES_FALLBACK, seed);
}

/**
 * The opening message body for an application / hiring request. A provided fit
 * note wins (it *is* the message); otherwise a personalised default is rotated
 * from the small template set using the seed.
 */
export function buildOpeningMessageBody({
  context,
  recipientName,
  fitNote,
  seed,
}: {
  context: OpeningMessageContext;
  recipientName?: string | null;
  fitNote?: string | null;
  seed: string;
}): string {
  const trimmedFit = typeof fitNote === "string" ? fitNote.trim() : "";
  if (trimmedFit) return trimmedFit;
  return context === "job"
    ? getDefaultApplicationOpeningMessage(recipientName, seed)
    : getDefaultHiringRequestOpeningMessage(recipientName, seed);
}
