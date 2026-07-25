import { requestJson, type BackendJob } from "./backendClient";

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
  "confirmed_by_recruiter",
  "edited_by_recruiter",
  "rejected_by_recruiter",
] as const;

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
};

export type JobImportDraftInitialize = {
  extraction_schema_version?: number;
  target_listing_schema_version?: number;
  supersedes_draft_id?: string | null;
  idempotency_key?: string | null;
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
  }
  return draft as unknown as JobImportDraft;
};

export async function createJobImportSource(
  accessToken: string,
  payload: JobImportSourceCreate
): Promise<JobImportSource> {
  const response = await requestJson<unknown>("/job-imports/sources", {
    method: "POST",
    body: JSON.stringify(payload),
    accessToken,
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
  payload: JobImportDraftInitialize = {}
): Promise<JobImportDraft> {
  const response = await requestJson<unknown>(
    `/job-imports/sources/${encodeURIComponent(sourceId)}/drafts`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      accessToken,
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
