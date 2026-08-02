import { requestJson, type BackendJob } from "./backendClient";

/**
 * How long the client waits for a provider-bound import request.
 *
 * The default write budget is 8s, which is shorter than the work: the backend
 * allows OPENAI_REQUEST_TIMEOUT_SECONDS (30s) with up to OPENAI_MAX_RETRIES (2)
 * retries, so a legitimate extraction can run to ~90s. Aborting at 8s cancels a
 * request the server is still working on, and the abort surfaces as status 0 —
 * i.e. "the backend is unreachable", about a backend that is fine.
 *
 * 120s clears the server's worst case with margin. The recruiter is not stuck
 * meanwhile: the canvas shows real progress and Cancel is always available.
 */
const JOB_IMPORT_PROCESSING_TIMEOUT_MS = 120_000;

/** Native conversion: database work, but it can involve a lot of rows. */
const JOB_IMPORT_APPLY_TIMEOUT_MS = 30_000;

const SOURCE_PROCESSING_STATES = [
  "awaiting_processing",
  "processing",
  "processed",
  "failed",
  "deleted",
] as const;

const DRAFT_PROCESSING_STATES = [
  "awaiting_processing",
  "processing",
  "processing_failed",
  "awaiting_recruiter_review",
  "partially_reviewed",
  "ready_to_apply",
  "applied_to_native_draft",
  "discarded",
  "superseded",
] as const;

const VALIDATION_STATES = ["not_validated", "invalid", "needs_review", "valid"] as const;
const CONFIRMATION_STATES = ["unreviewed", "partial", "confirmed"] as const;
const PROVENANCE_STATES = [
  "directly_supplied",
  "extracted_from_source",
  "suggested_inference",
  "conflicting_source_values",
  "missing",
] as const;
const REVIEW_STATES = ["pending", "confirmed", "edited", "rejected"] as const;
const AUTHORITY_STATES = [
  "unconfirmed",
  "prefilled_by_import",
  "confirmed_by_recruiter",
  "edited_by_recruiter",
  "rejected_by_recruiter",
] as const;

const DECISION_ORIGINS = [
  "explicit",
  "contextual_inference",
  "semantic_inference",
  "suggestion",
  "unknown",
] as const;

const DECISION_CONFIDENCES = ["high", "medium", "low"] as const;

const SOURCE_TYPES = [
  "pasted_text",
  "rough_description",
  "external_listing_text",
  "public_url",
  "screenshot",
  "screenshots",
  "document",
  "pdf",
  "other",
] as const;

export type JobImportSourceType = (typeof SOURCE_TYPES)[number];
export type JobImportJsonValue =
  | string
  | number
  | boolean
  | null
  | JobImportJsonValue[]
  | { [key: string]: JobImportJsonValue };
export type JobImportNonNullJsonValue = Exclude<JobImportJsonValue, null>;

export type JobImportSourceCreate = {
  source_type: JobImportSourceType;
  source_title?: string | null;
  original_text?: string | null;
  source_url?: string | null;
  original_filename?: string | null;
  content_type?: string | null;
  storage_references?: string[];
  idempotency_key?: string | null;
};

export type JobImportSource = {
  id: string;
  owner_user_id: string;
  source_type: JobImportSourceType;
  source_title: string | null;
  original_text: string | null;
  source_url: string | null;
  final_source_url: string | null;
  retrieved_at: string | null;
  retrieval_metadata: Record<string, unknown> | null;
  original_filename: string | null;
  content_type: string | null;
  storage_references: string[];
  processing_state: (typeof SOURCE_PROCESSING_STATES)[number];
  retention_policy: string;
  content_redacted_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type JobImportProvenance = (typeof PROVENANCE_STATES)[number];

export type JobImportReviewStatus = (typeof REVIEW_STATES)[number];

export type JobImportEvidence = {
  snippet: string;
  location?: {
    char_start?: number | null;
    char_end?: number | null;
    document_page?: number | null;
    screenshot_index?: number | null;
    source_url?: string | null;
  } | null;
};

export type JobImportField = {
  id: string;
  field_path: string;
  proposed_value: unknown;
  provenance_state: JobImportProvenance;
  review_status: JobImportReviewStatus;
  authority_state: (typeof AUTHORITY_STATES)[number];
  decision_origin: (typeof DECISION_ORIGINS)[number];
  decision_confidence: (typeof DECISION_CONFIDENCES)[number] | null;
  needs_review: boolean;
  rationale_code: string | null;
  evidence: JobImportEvidence[];
  conflicting_values: Array<{ value: unknown; evidence: JobImportEvidence[] }>;
  explanation: string | null;
  provider_confidence: Record<string, unknown> | null;
  confirmed_value: unknown;
  edited_value: unknown;
  effective_value: unknown;
  missing_requirement:
    | "publication_blocker"
    | "conditionally_required"
    | "recommended"
    | "optional";
  requires_confirmation: boolean;
  validation_errors: string[];
  selected_conflict_index: number | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type JobImportDraft = {
  id: string;
  owner_user_id: string;
  source_id: string;
  supersedes_draft_id: string | null;
  extraction_schema_version: number;
  target_listing_schema_version: number;
  processing_status: (typeof DRAFT_PROCESSING_STATES)[number];
  validation_status: (typeof VALIDATION_STATES)[number];
  confirmation_state: (typeof CONFIRMATION_STATES)[number];
  can_apply_to_native_draft: boolean;
  can_publish_directly: boolean;
  provider_name: string | null;
  model_name: string | null;
  model_version: string | null;
  instruction_version: string | null;
  provider_metadata: Record<string, unknown> | null;
  processing_warnings: Array<Record<string, unknown>>;
  missing_fields: Array<Record<string, unknown>>;
  validation_errors: Record<string, unknown>;
  review_sections: Array<{ section: string; fields: string[] }>;
  target_job_id: string | null;
  processed_at: string | null;
  applied_at: string | null;
  discarded_at: string | null;
  created_at: string;
  updated_at: string;
  fields: JobImportField[];
  /**
   * Answers the recruiter gave while extraction was still running, keyed by
   * field path. Server-owned and durable, so a refresh restores them without
   * any browser storage.
   */
  recruiter_prefill: Record<string, unknown>;
  /**
   * Which details the client may ask about before the draft is prepared. The
   * server decides this; the client must never widen it locally.
   */
  early_question_fields: string[];
};

export type JobImportDraftInitialize = {
  extraction_schema_version?: number;
  target_listing_schema_version?: number;
  supersedes_draft_id?: string | null;
  idempotency_key?: string | null;
};

export type JobImportProcessOutcome =
  | "processed"
  | "already_processing"
  | "already_processed";

export type JobImportProcessResponse = {
  outcome: JobImportProcessOutcome;
  draft: JobImportDraft;
};

/**
 * The checkpointed conversation, as the server reports it.
 *
 * `waiting` is the one field the UI must never infer for itself: it is the
 * server's statement that nothing is running, and it is what the paused
 * progress treatment and Bea's listening pose are driven from.
 */
export type JobImportConversationState =
  | "source_received"
  | "preparing"
  | "waiting_for_recruiter"
  | "resuming"
  | "validating"
  | "optional_improvements"
  | "ready_for_native_draft"
  | "converted"
  | "processing_failed"
  | "abandoned";

export type JobImportActiveQuestion = {
  field_path: string;
  kind: "mandatory" | "confirmation" | "optional";
  asked_at?: string;
  context_version?: number;
  /** Present when the assistant is proposing a value to confirm. */
  suggested_value?: unknown;
  rationale_code?: string;
  explanation?: string;
  /**
   * Candidate answers the source itself supplied, with the wording each came
   * from. Present when the source contradicted itself.
   */
  alternatives?: Array<{ value: unknown; evidence: string[] }>;
  /** The alternative the job title already settles, if any. */
  recommended_value?: unknown;
};

export type JobImportConversation = {
  state: JobImportConversationState;
  active_question: JobImportActiveQuestion | null;
  recruiter_context_version: number;
  continuation_count: number;
  waiting: boolean;
  /**
   * The assistant's own completion rule. Deliberately *not* the same as
   * "a native draft could exist" — a private draft can exist almost from the
   * start, which says nothing about whether questions are still open.
   */
  ready_for_draft: boolean;
  phase: "essential" | "optional" | "complete";
  /** Essential questions left. Optional ones never block, so are not counted. */
  essential_remaining: number;
  manual_continuation: boolean;
};

export type JobImportDraftContext = {
  draft: JobImportDraft;
  source_type: JobImportSourceType;
  source_label: string;
  source_url: string | null;
};

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label} response.`);
  }
  return value as Record<string, unknown>;
};

const requireKnownState = <T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string
): T[number] => {
  if (
    typeof value !== "string" ||
    !(allowed as readonly string[]).includes(value)
  ) {
    throw new Error(`Unsupported ${label} state.`);
  }
  return value as T[number];
};

export const decodeJobImportSource = (value: unknown): JobImportSource => {
  const source = requireRecord(value, "job-import source");
  requireKnownState(source.source_type, SOURCE_TYPES, "source type");
  requireKnownState(source.processing_state, SOURCE_PROCESSING_STATES, "source processing");
  if (typeof source.id !== "string" || typeof source.owner_user_id !== "string") {
    throw new Error("Invalid job-import source identity.");
  }
  return source as unknown as JobImportSource;
};

export const decodeJobImportDraft = (value: unknown): JobImportDraft => {
  const draft = requireRecord(value, "job-import draft");
  requireKnownState(draft.processing_status, DRAFT_PROCESSING_STATES, "draft processing");
  requireKnownState(draft.validation_status, VALIDATION_STATES, "draft validation");
  requireKnownState(draft.confirmation_state, CONFIRMATION_STATES, "draft confirmation");
  if (!Array.isArray(draft.fields)) {
    throw new Error("Invalid job-import field collection.");
  }
  for (const rawField of draft.fields) {
    const field = requireRecord(rawField, "job-import field");
    requireKnownState(field.provenance_state, PROVENANCE_STATES, "field provenance");
    requireKnownState(field.review_status, REVIEW_STATES, "field review");
    requireKnownState(field.authority_state, AUTHORITY_STATES, "field authority");
    requireKnownState(field.decision_origin, DECISION_ORIGINS, "field decision origin");
    if (field.decision_confidence !== null) {
      requireKnownState(
        field.decision_confidence,
        DECISION_CONFIDENCES,
        "field decision confidence"
      );
    }
  }
  // Tolerated rather than required: fixtures and mock drafts predate the staged
  // prefill contract, and an absent value means "no early answers", not a
  // malformed draft. A present value still has to be the right shape.
  if (
    draft.recruiter_prefill !== undefined &&
    draft.recruiter_prefill !== null &&
    (typeof draft.recruiter_prefill !== "object" || Array.isArray(draft.recruiter_prefill))
  ) {
    throw new Error("Invalid job-import recruiter prefill.");
  }
  draft.recruiter_prefill = (draft.recruiter_prefill ?? {}) as Record<string, unknown>;
  draft.early_question_fields = Array.isArray(draft.early_question_fields)
    ? draft.early_question_fields.filter(
        (fieldPath): fieldPath is string => typeof fieldPath === "string"
      )
    : [];
  return draft as unknown as JobImportDraft;
};

export async function createJobImportSource(
  accessToken: string,
  payload: JobImportSourceCreate,
  signal?: AbortSignal
): Promise<JobImportSource> {
  const response = await requestJson<unknown>("/job-imports/sources", {
    method: "POST",
    body: JSON.stringify(payload),
    accessToken,
    signal,
  });
  return decodeJobImportSource(response);
}

export async function createJobImportUrlSource(
  accessToken: string,
  payload: {
    source_url: string;
    source_title?: string | null;
    idempotency_key?: string | null;
  },
  signal?: AbortSignal
): Promise<JobImportSource> {
  const response = await requestJson<unknown>("/job-imports/url-sources", {
    method: "POST",
    body: JSON.stringify(payload),
    accessToken,
    timeoutMs: 20_000,
    signal,
  });
  return decodeJobImportSource(response);
}

export async function getJobImportSource(
  accessToken: string,
  sourceId: string
): Promise<JobImportSource> {
  const response = await requestJson<unknown>(
    `/job-imports/sources/${encodeURIComponent(sourceId)}`,
    { accessToken }
  );
  return decodeJobImportSource(response);
}

export async function redactJobImportSource(
  accessToken: string,
  sourceId: string
): Promise<void> {
  return requestJson<void>(
    `/job-imports/sources/${encodeURIComponent(sourceId)}`,
    { method: "DELETE", accessToken }
  );
}

export async function initializeJobImportDraft(
  accessToken: string,
  sourceId: string,
  payload: JobImportDraftInitialize = {},
  signal?: AbortSignal
): Promise<JobImportDraft> {
  const response = await requestJson<unknown>(
    `/job-imports/sources/${encodeURIComponent(sourceId)}/drafts`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      accessToken,
      signal,
    }
  );
  return decodeJobImportDraft(response);
}

export async function getJobImportDraft(
  accessToken: string,
  draftId: string
): Promise<JobImportDraft> {
  const response = await requestJson<unknown>(
    `/job-imports/drafts/${encodeURIComponent(draftId)}`,
    { accessToken }
  );
  return decodeJobImportDraft(response);
}

export async function processJobImportDraft(
  accessToken: string,
  draftId: string,
  signal?: AbortSignal
): Promise<JobImportProcessResponse> {
  const response = await requestJson<unknown>(
    `/job-imports/drafts/${encodeURIComponent(draftId)}/process`,
    {
      method: "POST",
      body: JSON.stringify({}),
      accessToken,
      timeoutMs: JOB_IMPORT_PROCESSING_TIMEOUT_MS,
      signal,
    }
  );
  const result = requireRecord(response, "job-import process");
  const outcome = requireKnownState(
    result.outcome,
    ["processed", "already_processing", "already_processed"] as const,
    "job-import process"
  );
  return {
    outcome,
    draft: decodeJobImportDraft(result.draft),
  };
}

export async function reviewJobImportField(
  accessToken: string,
  draftId: string,
  fieldPath: string,
  payload:
    | { action: "accept" | "reject" | "reset" }
    | { action: "edit"; edited_value: JobImportNonNullJsonValue }
): Promise<JobImportDraft> {
  const response = await requestJson<unknown>(
    `/job-imports/drafts/${encodeURIComponent(draftId)}/fields/${encodeURIComponent(fieldPath)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
      accessToken,
    }
  );
  return decodeJobImportDraft(response);
}

/**
 * Answer a recruiter-owned detail while the draft is still being prepared.
 *
 * Only the field paths the server published in `early_question_fields` are
 * accepted; anything else is refused with JOB_IMPORT_FIELD_NOT_EARLY_ANSWERABLE.
 * Once extraction lands the window closes and the ordinary review mutations own
 * the field.
 */
export async function setJobImportPrefill(
  accessToken: string,
  draftId: string,
  fieldPath: string,
  value: JobImportNonNullJsonValue,
  signal?: AbortSignal
): Promise<JobImportDraft> {
  const response = await requestJson<unknown>(
    `/job-imports/drafts/${encodeURIComponent(draftId)}/prefill/${encodeURIComponent(fieldPath)}`,
    {
      method: "PUT",
      body: JSON.stringify({ value }),
      accessToken,
      signal,
    }
  );
  return decodeJobImportDraft(response);
}

const decodeConversation = (value: unknown): JobImportConversation => {
  const body = requireRecord(value, "job-import conversation");
  if (typeof body.state !== "string" || typeof body.waiting !== "boolean") {
    throw new Error("Invalid job-import conversation response.");
  }
  return body as unknown as JobImportConversation;
};

/**
 * Read the conversation. Safe to poll: the server performs no transition and
 * starts no provider work on this path.
 */
export async function getJobImportConversation(
  accessToken: string,
  draftId: string,
  signal?: AbortSignal
): Promise<JobImportConversation> {
  return decodeConversation(
    await requestJson<unknown>(
      `/job-imports/drafts/${encodeURIComponent(draftId)}/conversation`,
      { accessToken, signal }
    )
  );
}

/** Enter the conversation for a draft whose extraction already landed. */
export async function beginJobImportConversation(
  accessToken: string,
  draftId: string
): Promise<JobImportConversation> {
  return decodeConversation(
    await requestJson<unknown>(
      `/job-imports/drafts/${encodeURIComponent(draftId)}/conversation/begin`,
      { method: "POST", accessToken }
    )
  );
}

/**
 * Answer the one open question.
 *
 * `expectedContextVersion` makes a resubmission a no-op rather than a second
 * advance, so a double click cannot push the conversation forward twice.
 */
export async function answerJobImportQuestion(
  accessToken: string,
  draftId: string,
  fieldPath: string,
  value: JobImportNonNullJsonValue,
  expectedContextVersion?: number
): Promise<JobImportConversation> {
  return decodeConversation(
    await requestJson<unknown>(
      `/job-imports/drafts/${encodeURIComponent(draftId)}/conversation/answer`,
      {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          field_path: fieldPath,
          value,
          expected_context_version: expectedContextVersion,
        }),
      }
    )
  );
}

/** Skip the active optional suggestion, or every remaining one. */
export async function skipJobImportQuestion(
  accessToken: string,
  draftId: string,
  remaining = false
): Promise<JobImportConversation> {
  return decodeConversation(
    await requestJson<unknown>(
      `/job-imports/drafts/${encodeURIComponent(draftId)}/conversation/skip?remaining=${
        remaining ? "true" : "false"
      }`,
      { method: "POST", accessToken }
    )
  );
}

/**
 * Leave the conversation and finish in the ordinary editor.
 *
 * The one normal route that hands off with questions still open: everything
 * answered is kept, and the rest become ordinary empty draft fields.
 */
export async function continueJobImportManually(
  accessToken: string,
  draftId: string
): Promise<JobImportConversation> {
  return decodeConversation(
    await requestJson<unknown>(
      `/job-imports/drafts/${encodeURIComponent(draftId)}/conversation/continue-manually`,
      { method: "POST", accessToken }
    )
  );
}

/** Record that the recruiter stepped away. Keeps the draft resumable. */
export async function pauseJobImportConversation(
  accessToken: string,
  draftId: string
): Promise<JobImportConversation> {
  return decodeConversation(
    await requestJson<unknown>(
      `/job-imports/drafts/${encodeURIComponent(draftId)}/conversation/pause`,
      { method: "POST", accessToken }
    )
  );
}

export async function resolveJobImportConflict(
  accessToken: string,
  draftId: string,
  fieldPath: string,
  payload:
    | { selected_value_index: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 }
    | { replacement_value: JobImportNonNullJsonValue }
): Promise<JobImportDraft> {
  const response = await requestJson<unknown>(
    `/job-imports/drafts/${encodeURIComponent(draftId)}/fields/${encodeURIComponent(fieldPath)}/resolve`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      accessToken,
    }
  );
  return decodeJobImportDraft(response);
}

export async function discardJobImportDraft(
  accessToken: string,
  draftId: string
): Promise<JobImportDraft> {
  const response = await requestJson<unknown>(
    `/job-imports/drafts/${encodeURIComponent(draftId)}/discard`,
    { method: "POST", accessToken }
  );
  return decodeJobImportDraft(response);
}

export async function deleteJobImportDraft(
  accessToken: string,
  draftId: string
): Promise<void> {
  return requestJson<void>(
    `/job-imports/drafts/${encodeURIComponent(draftId)}`,
    { method: "DELETE", accessToken }
  );
}

export async function applyJobImportDraft(
  accessToken: string,
  draftId: string
): Promise<{ draft: JobImportDraft; job: BackendJob; created: boolean }> {
  const response = await requestJson<unknown>(
    `/job-imports/drafts/${encodeURIComponent(draftId)}/apply`,
    {
      method: "POST",
      body: JSON.stringify({ mode: "create_new" }),
      accessToken,
      timeoutMs: JOB_IMPORT_APPLY_TIMEOUT_MS,
    }
  );
  const result = requireRecord(response, "job-import apply");
  if (typeof result.created !== "boolean") {
    throw new Error("Invalid job-import apply outcome.");
  }
  return {
    draft: decodeJobImportDraft(result.draft),
    job: requireRecord(result.job, "native job") as BackendJob,
    created: result.created,
  };
}

export async function attachJobImportDraft(
  accessToken: string,
  draftId: string,
  targetJobId: string
): Promise<{ draft: JobImportDraft; job: BackendJob; linked: boolean }> {
  const response = await requestJson<unknown>(
    `/job-imports/drafts/${encodeURIComponent(draftId)}/attach`,
    {
      method: "POST",
      body: JSON.stringify({ target_job_id: targetJobId }),
      accessToken,
    }
  );
  const result = requireRecord(response, "job-import attach");
  if (typeof result.linked !== "boolean") {
    throw new Error("Invalid job-import attach outcome.");
  }
  return {
    draft: decodeJobImportDraft(result.draft),
    job: requireRecord(result.job, "native job") as BackendJob,
    linked: result.linked,
  };
}

export async function getJobImportContextForNativeJob(
  accessToken: string,
  jobId: string
): Promise<JobImportDraftContext> {
  const response = requireRecord(
    await requestJson<unknown>(
      `/job-imports/native-jobs/${encodeURIComponent(jobId)}/context`,
      { accessToken }
    ),
    "native job import context"
  );
  if (
    typeof response.source_type !== "string" ||
    !(SOURCE_TYPES as readonly string[]).includes(response.source_type) ||
    typeof response.source_label !== "string"
  ) {
    throw new Error("Invalid native job import context.");
  }
  return {
    draft: decodeJobImportDraft(response.draft),
    source_type: response.source_type as JobImportSourceType,
    source_label: response.source_label,
    source_url: typeof response.source_url === "string" ? response.source_url : null,
  };
}

/**
 * Development-only scenarios. Mirrors DEVELOPMENT_IMPORT_SCENARIOS on the
 * server; the endpoint rejects anything not on its own list, so this union is a
 * convenience for the dev picker rather than the authority.
 */
export type DevelopmentJobImportScenario =
  // Processed drafts with a populated review queue.
  | "strong-decisions"
  | "thumbnail-designer"
  | "scriptwriter"
  | "clean-import"
  // Land in the checkpointed conversation, waiting on one question.
  | "checkpoint-currency"
  | "checkpoint-trial"
  // A real 503 for the failure surface.
  | "processing-failure"
  // Drafts left genuinely mid-processing, for staged behaviour.
  | "delayed-processing"
  | "refresh-resume"
  | "answer-precedence";

export async function createDevelopmentJobImportFixture(
  accessToken: string,
  scenario: DevelopmentJobImportScenario = "strong-decisions"
): Promise<{ draft: JobImportDraft; created: boolean }> {
  const response = await requestJson<unknown>(
    `/dev/job-import-review?scenario=${encodeURIComponent(scenario)}&fresh=true`,
    {
      method: "POST",
      body: JSON.stringify({}),
      accessToken,
      // Seeds a source, a draft and every field row in one request.
      timeoutMs: JOB_IMPORT_APPLY_TIMEOUT_MS,
    }
  );
  const result = requireRecord(response, "development job-import fixture");
  if (typeof result.created !== "boolean") {
    throw new Error("Invalid development job-import fixture outcome.");
  }
  return {
    draft: decodeJobImportDraft(result.draft),
    created: result.created,
  };
}
