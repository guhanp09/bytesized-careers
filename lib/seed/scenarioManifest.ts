/**
 * Adapting a generated manifest into the workspace's view models.
 *
 * This is a *thin* consumer, and thin is the requirement rather than a
 * preference. It maps fields and materialises timestamps; it does not decide
 * what a status is called, how an amount reads, how long a turnaround is, or
 * what a portfolio poster looks like. Every one of those already has one
 * implementation that the live backend path uses, and duplicating any of them
 * here would recreate exactly the drift this phase exists to remove.
 *
 * The one thing it genuinely owns is time. The manifest stores offsets in
 * seconds so it can stay byte-identical in git; real ISO instants are produced
 * here as `anchor + offset`.
 */

import {
  interactionStatusFromBackend,
  type InteractionCreatorFacts,
  type OwnerInteraction,
} from "../ownerInteractions.ts";
import { MANIFEST_VERSION, type ScenarioManifest, type ManifestRelationship } from "./manifestTypes.ts";

export class ManifestVersionError extends Error {}

/**
 * Two anchoring modes, for two genuinely different needs.
 *
 * `fixed` pins every scenario to one instant so screenshots and deterministic
 * tests compare like with like. `now` anchors to the moment of loading, so a
 * developer browsing the workspace sees "4h ago" rather than a date from
 * whenever the manifest happened to be generated.
 */
export type AnchorMode = "now" | "fixed";

/** 2026-01-15T09:00:00Z — arbitrary, stable, and comfortably in the past. */
export const FIXED_ANCHOR_MS = Date.parse("2026-01-15T09:00:00.000Z");

export function anchorFor(mode: AnchorMode, now = Date.now()): number {
  return mode === "fixed" ? FIXED_ANCHOR_MS : now;
}

const iso = (anchor: number, offsetSeconds: number): string =>
  new Date(anchor + offsetSeconds * 1000).toISOString();

/**
 * Which side of the relationship the viewer is on.
 *
 * The same record is an "application" the recruiter received and an
 * "application" the talent sent, and almost everything the workspace shows
 * depends on which of those the viewer is. The manifest stores the relationship
 * once; this decides the direction per viewer.
 */
export type Viewer = { recruiterIds: Set<string>; talentIds: Set<string> };

export function viewerFor(manifest: ScenarioManifest, mode: "recruiter" | "talent"): Viewer {
  const recruiterIds = new Set<string>();
  const talentIds = new Set<string>();
  for (const actor of manifest.actors ?? []) {
    if (actor.sides.includes("recruiter")) recruiterIds.add(actor.id);
    if (actor.sides.includes("talent")) talentIds.add(actor.id);
  }
  return mode === "recruiter"
    ? { recruiterIds, talentIds }
    : { recruiterIds: talentIds, talentIds: recruiterIds };
}

export function checkManifestVersion(version: number): void {
  if (version !== MANIFEST_VERSION) {
    throw new ManifestVersionError(
      `Scenario manifest version ${version} is not supported by this build (expected ${MANIFEST_VERSION}). ` +
        "Regenerate the manifests with: cd backend && .venv/bin/python -m app.db.creator_scenarios"
    );
  }
}

/*
  There is deliberately no status mapping in this file.

  `interactionStatusFromBackend` already turns a backend stage into the display
  union, and it is already direction-dependent — `new` on a record you received
  is something waiting for you, while `new` on one you sent is something you are
  waiting on. Writing that logic a second time here is precisely the drift this
  phase exists to remove, so the adapter calls the same function the live
  backend path calls.
*/

function creatorFactsFor(manifest: ScenarioManifest, jobId: string | undefined): {
  facts: InteractionCreatorFacts | null;
  title: string;
  budget: string;
  channelName: string | null;
  location: string | null;
  workMode: string;
  experience: string | null;
  tags: string[];
  status: string;
} | null {
  if (!jobId) return null;
  const job = (manifest.jobs ?? []).find((entry) => entry.id === jobId);
  if (!job) return null;
  const owner = (manifest.actors ?? []).find((actor) => actor.id === job.owner_id);
  return {
    title: job.title,
    // The legacy display string. Left deliberately blank so the projection uses
    // the structured model rather than falling back to a preformatted amount —
    // the manifest never stores one.
    budget: "",
    channelName: owner?.display_name ?? null,
    location: job.location ?? null,
    workMode: job.work_mode ?? "Remote",
    experience: job.experience ?? null,
    tags: job.tags ?? [],
    status: job.status ?? "published",
    facts: {
      platforms: job.platforms ?? null,
      formats: job.formats ?? null,
      niches: job.niches ?? null,
      turnaround:
        job.turnaround_value != null
          ? {
              value: job.turnaround_value,
              unit: job.turnaround_unit ?? null,
              basis: job.turnaround_basis ?? null,
            }
          : null,
      compensation: {
        mode: job.compensation_mode ?? null,
        minimum: job.compensation_min ?? null,
        maximum: job.compensation_max ?? null,
        currency: job.compensation_currency ?? null,
        unit: job.compensation_unit ?? null,
        trialStatus: job.trial_status ?? null,
        trialAmount: job.trial_amount ?? null,
        trialCurrency: job.trial_currency ?? null,
      },
      channelHandle: owner?.channel_handle ?? null,
      employerKind: owner?.employer_kind ?? null,
      subscribers: owner?.subscribers ?? null,
      cadence: owner?.upload_cadence ?? null,
    },
  };
}

/**
 * One relationship, as the given side sees it.
 *
 * Returns null when the viewer is not a participant — which is how the Talent
 * inbox and the Recruiter inbox read the same manifest and each see only their
 * own half.
 */
export function toOwnerInteraction(
  manifest: ScenarioManifest,
  rel: ManifestRelationship,
  options: { anchor: number; mode: "recruiter" | "talent" }
): OwnerInteraction | null {
  const { anchor, mode } = options;
  const recruiter = (manifest.actors ?? []).find((actor) => actor.id === rel.recruiter_id);
  const talent = (manifest.actors ?? []).find((actor) => actor.id === rel.talent_id);
  if (!recruiter || !talent) return null;

  // Who is "me" decides direction. A recruiter received the applications to
  // their jobs and sent the hiring requests; for talent it is the mirror.
  const asRecruiter = mode === "recruiter";
  const direction: "sent" | "received" =
    rel.kind === "application" ? (asRecruiter ? "received" : "sent") : asRecruiter ? "sent" : "received";
  const counterparty = asRecruiter ? talent : recruiter;

  /*
    Whoever received a record manages it; whoever sent it is the participant.

    So the *sent* view must be driven by `participant_stage` — what this person
    was actually told — not by `stage`, which is the manager's private position.
    Reading `stage` here leaked a private "not proceeding" to the applicant as
    their own status, which is exactly the privacy rule Phase 1 established.
    The parity suite caught it on the rejected-after-hired conflict fixture.
  */
  const viewerStage =
    direction === "sent" ? rel.participant_stage ?? rel.stage : rel.stage;

  const job = creatorFactsFor(manifest, rel.job_id ?? undefined);
  const messages = [...(rel.messages ?? [])].sort((a, b) => a.offset_seconds - b.offset_seconds);
  const last = messages[messages.length - 1];

  const portfolio = (rel.portfolio_ids ?? [])
    .map((id) => (manifest.portfolio ?? []).find((item) => item.id === id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((item) => ({
      id: item.id,
      title: item.title,
      url: item.url ?? null,
      thumbnail_url: item.thumbnail_url ?? null,
      // `duration_seconds` is a number; the shared formatter turns it into
      // "12:04" so no second duration format exists.
      duration: item.duration_seconds ?? null,
      platform: item.platform ?? null,
      format: item.format ?? null,
      niche: item.niche ?? null,
      role: item.role ?? null,
      source_type: item.media === "video" ? "youtube" : item.media === "image" ? "behance" : "other",
    }));

  return {
    id: rel.id,
    mode: asRecruiter ? "hiring" : "talent",
    direction,
    kind: rel.kind === "application" ? "application" : "hiring_request",
    status: interactionStatusFromBackend(
      rel.kind === "application" ? "application" : "hiring_request",
      direction,
      viewerStage
    ),
    backendStatus: viewerStage,
    participantBackendStatus: rel.participant_stage ?? rel.stage,
    archivedAt: rel.archived ? iso(anchor, rel.updated_offset) : null,
    // The manager's private note is never visible from the other side.
    managerNote: direction === "received" ? rel.manager_note ?? null : null,
    title: direction === "received" && rel.kind === "application" ? counterparty.display_name : job?.title ?? counterparty.display_name,
    contextLabel: job?.title ?? null,
    counterpartyName: counterparty.display_name,
    counterpartyUserId: counterparty.id,
    counterpartyAvatarUrl: counterparty.avatar_url ?? null,
    createdAt: iso(anchor, rel.created_offset),
    updatedAt: iso(anchor, rel.updated_offset),
    unread: (rel.unread ?? 0) > 0,
    message: last?.body ?? rel.cover_note ?? "",
    job: job
      ? {
          jobId: rel.job_id ?? null,
          title: job.title,
          channelName: job.channelName,
          channelLogoUrl: null,
          channelProfileSlug: null,
          budget: job.budget,
          workMode: job.workMode,
          location: job.location,
          experience: job.experience,
          tags: job.tags,
          listingStatus: job.status === "closed" ? "Closed" : "Open",
          creator: job.facts,
        }
      : null,
    portfolio,
    firstMessageAnswers: portfolio.length ? { relevant_portfolio: portfolio } : null,
    thread: messages.map((message) => ({
      id: message.id,
      body: message.body,
      sentAt: iso(anchor, message.offset_seconds),
      fromMe: asRecruiter ? message.sender_id === recruiter.id : message.sender_id === talent.id,
      kind: message.kind === "status" ? "status" : "text",
    })),
    timeline: [
      {
        id: `${rel.id}-created`,
        label: rel.kind === "application" ? "Application received" : "Request sent",
        occurredAt: iso(anchor, rel.created_offset),
      },
    ],
  } as OwnerInteraction;
}

/** Every relationship in the manifest, as one side sees it. */
export function toOwnerInteractions(
  manifest: ScenarioManifest,
  options: { anchor?: number; anchorMode?: AnchorMode; mode: "recruiter" | "talent"; now?: number }
): OwnerInteraction[] {
  checkManifestVersion(manifest.version);
  const anchor = options.anchor ?? anchorFor(options.anchorMode ?? "now", options.now);
  const out: OwnerInteraction[] = [];
  // Empty collections are pruned from the committed JSON — a missing key means
  // the same thing as an empty list, and keeping both forms would double the
  // diff noise. The `empty` scenario has no `relationships` key at all.
  for (const rel of manifest.relationships ?? []) {
    const mapped = toOwnerInteraction(manifest, rel, { anchor, mode: options.mode });
    if (mapped) out.push(mapped);
  }
  // Newest first, which is what the inbox expects and what the backend path
  // already produces.
  return out.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
