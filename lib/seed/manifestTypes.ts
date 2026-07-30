/**
 * The manifest, as TypeScript sees it.
 *
 * A hand-maintained mirror of `backend/app/db/creator_scenarios/schema.py`, and
 * deliberately only that: it describes the shape, never the content. The
 * version constant is the guard — if the Python side bumps it and this side has
 * not followed, every consumer refuses the manifest instead of reading fields
 * that may have moved.
 */

/** Must match `MANIFEST_VERSION` in the generator. */
export const MANIFEST_VERSION = 2;

export type ManifestActor = {
  id: string;
  username: string;
  display_name: string;
  email: string;
  sides: string[];
  avatar_url?: string | null;
  location?: string | null;
  headline?: string | null;
  deactivated?: boolean;
  employer_kind?: string | null;
  channel_handle?: string | null;
  subscribers?: number | null;
  upload_cadence?: string | null;
  /**
   * What this person charges and how long they have been doing it — the two
   * facts the talent context card shows beside the name. No rate *unit*: the
   * listing table has no column for one, and both consumers format these three
   * values with the same `formatTalentRate`.
   */
  rate_min?: number | null;
  rate_max?: number | null;
  rate_currency?: string | null;
  /** Exact whole years. Never a range, never a level label. */
  experience_years?: number | null;
  availability?: string | null;
  /**
   * The public profile, as the product describes it rather than as any one
   * database stores it. The backend keeps talent and recruiter metadata in
   * separate columns (`creator_platforms` vs `hiring_platforms`, content style
   * vs `hiring_niches`); the manifest keeps one vocabulary and lets each
   * consumer decide which side an actor's lists belong to, from `sides`.
   *
   * Without these an applicant resolved to a name over an empty page — which
   * is the one page a review actually turns on.
   */
  bio?: string | null;
  timezone?: string | null;
  availability_status?: string | null;
  skills?: string[];
  tools?: string[];
  public_links?: string[];
  roles?: string[];
  platforms?: string[];
  formats?: string[];
  niches?: string[];
  languages?: string[];
  turnaround?: string | null;
  working_hours?: string | null;
  work_mode?: string | null;
  /** What kind of hiring account this is. Recruiters only. */
  description?: string | null;
  /** A reading of `subscribers`, never an independent claim. */
  audience_band?: string | null;
  verification_status?: string | null;
};

export type ManifestPortfolioItem = {
  id: string;
  owner_id: string;
  title: string;
  media: "video" | "image" | "audio" | "link";
  url?: string | null;
  thumbnail_url?: string | null;
  /** Seconds. Formatted by the shared projection, never stored as "12:04". */
  duration_seconds?: number | null;
  platform?: string | null;
  format?: string | null;
  niche?: string | null;
  role?: string | null;
  /** What the work is, and what this person did on it. */
  description?: string | null;
  contribution?: string | null;
  tools?: string[];
  /** A URL chosen to fail, so the poster fallback is exercised for real. */
  thumbnail_broken?: boolean;
};

export type ManifestJob = {
  id: string;
  owner_id: string;
  title: string;
  platforms: string[];
  formats: string[];
  niches: string[];
  turnaround_value?: number | null;
  turnaround_unit?: string | null;
  turnaround_basis?: string | null;
  compensation_mode?: string | null;
  compensation_min?: number | null;
  compensation_max?: number | null;
  compensation_currency?: string | null;
  compensation_unit?: string | null;
  location: string;
  work_mode: string;
  experience?: string | null;
  status?: string;
  posted_offset?: number;
  trial_status?: string | null;
  trial_amount?: number | null;
  trial_currency?: string | null;
  tags?: string[];
  /**
   * "manual" or "imported" — how the listing came to exist. Screening prompts
   * are the one field the importer may not author, so an imported job that
   * screens is where that boundary is actually observable.
   */
  origin?: string;
  legacy_key?: string | null;
};

export type ManifestMessage = {
  id: string;
  conversation_id: string;
  /** Null is the platform speaking, not a participant. */
  sender_id?: string | null;
  body: string;
  offset_seconds: number;
  kind?: "text" | "status" | "screening_questions" | "screening_answers";
  read?: boolean;
  /**
   * Curated structured payload for the kinds the Inbox renders natively — the
   * screening question snapshot, and the answers given against it.
   */
  metadata?: {
    message_kind?: string;
    automated?: boolean;
    snapshot_version?: string;
    questions?: unknown[];
    answers?: unknown[];
  };
};

export type ManifestInterview = {
  id: string;
  relationship_id: string;
  state: "proposed" | "confirmed" | "completed" | "cancelled";
  /** Positive is still ahead; negative has passed. */
  scheduled_offset: number;
  method?: string;
  detail?: string | null;
  note?: string | null;
};

export type ManifestEngagement = {
  id: string;
  relationship_id: string;
  state: string;
  /** Absent means nothing asserted — not the same claim as "not_applicable". */
  payment_state?: string | null;
  payment_note?: string | null;
  payment_offset?: number | null;
  started_offset?: number | null;
  completed_offset?: number | null;
};

export type ManifestRelationship = {
  id: string;
  kind: "application" | "hiring_request";
  job_id?: string | null;
  recruiter_id: string;
  talent_id: string;
  /** Backend canonical stage. Never a display label. */
  stage: string;
  /** What the counterparty has been told; diverges from `stage` on purpose. */
  participant_stage?: string | null;
  created_offset: number;
  updated_offset: number;
  conversation_id?: string | null;
  messages?: ManifestMessage[];
  portfolio_ids?: string[];
  cover_note?: string | null;
  answers?: Record<string, unknown>;
  starred?: boolean;
  snoozed_offset?: number | null;
  manager_note?: string | null;
  archived?: boolean;
  unread?: number;
  interview?: ManifestInterview | null;
  engagement?: ManifestEngagement | null;
  /** Set when the record exists to exercise a legacy or contradictory state. */
  historical?: string | null;
};

/** Conditions that live in the browser, never in a table. */
export type ManifestClientState = {
  id: string;
  relationship_id: string;
  kind: "draft" | "send_failed" | "broken_image" | "mobile_only";
  body?: string | null;
  note?: string | null;
};

export type ManifestIndexEntry = {
  scenario: string;
  persona: string;
  route: string;
  job_id?: string | null;
  relationship_id: string;
  conversation_id?: string | null;
  expected_stage: string;
  expected_condition: string;
  action_to_test: string;
};

export type ScenarioManifest = {
  version: number;
  scenario: string;
  seed: number;
  description: string;
  actors: ManifestActor[];
  jobs: ManifestJob[];
  portfolio: ManifestPortfolioItem[];
  relationships: ManifestRelationship[];
  client_state?: ManifestClientState[];
  index?: ManifestIndexEntry[];
  stats?: Record<string, unknown>;
};
