import { requestJson, type BackendJob } from "./backendClient";

export type JobImportSourceType =
  | "pasted_text"
  | "rough_description"
  | "external_listing_text"
  | "public_url"
  | "screenshot"
  | "screenshots"
  | "document"
  | "pdf"
  | "other";

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
  processing_state: "awaiting_processing" | "processing" | "processed" | "failed" | "deleted";
  retention_policy: string;
  content_redacted_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type JobImportProvenance =
  | "directly_supplied"
  | "extracted_from_source"
  | "suggested_inference"
  | "conflicting_source_values"
  | "missing";

export type JobImportReviewStatus = "pending" | "confirmed" | "edited" | "rejected";

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
  authority_state:
    | "unconfirmed"
    | "confirmed_by_recruiter"
    | "edited_by_recruiter"
    | "rejected_by_recruiter";
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
  processing_status:
    | "awaiting_processing"
    | "processing"
    | "processing_failed"
    | "awaiting_recruiter_review"
    | "partially_reviewed"
    | "ready_to_apply"
    | "applied_to_native_draft"
    | "discarded"
    | "superseded";
  validation_status: "not_validated" | "invalid" | "needs_review" | "valid";
  confirmation_state: "unreviewed" | "partial" | "confirmed";
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

export async function createJobImportSource(
  accessToken: string,
  payload: JobImportSourceCreate
): Promise<JobImportSource> {
  return requestJson<JobImportSource>("/job-imports/sources", {
    method: "POST",
    body: JSON.stringify(payload),
    accessToken,
  });
}

export async function getJobImportSource(
  accessToken: string,
  sourceId: string
): Promise<JobImportSource> {
  return requestJson<JobImportSource>(
    `/job-imports/sources/${encodeURIComponent(sourceId)}`,
    { accessToken }
  );
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
  return requestJson<JobImportDraft>(
    `/job-imports/sources/${encodeURIComponent(sourceId)}/drafts`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      accessToken,
    }
  );
}

export async function getJobImportDraft(
  accessToken: string,
  draftId: string
): Promise<JobImportDraft> {
  return requestJson<JobImportDraft>(
    `/job-imports/drafts/${encodeURIComponent(draftId)}`,
    { accessToken }
  );
}

export async function reviewJobImportField(
  accessToken: string,
  draftId: string,
  fieldPath: string,
  payload:
    | { action: "accept" | "reject" | "reset" }
    | { action: "edit"; edited_value: unknown }
): Promise<JobImportDraft> {
  return requestJson<JobImportDraft>(
    `/job-imports/drafts/${encodeURIComponent(draftId)}/fields/${encodeURIComponent(fieldPath)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
      accessToken,
    }
  );
}

export async function resolveJobImportConflict(
  accessToken: string,
  draftId: string,
  fieldPath: string,
  payload:
    | { selected_value_index: number }
    | { replacement_value: unknown }
): Promise<JobImportDraft> {
  return requestJson<JobImportDraft>(
    `/job-imports/drafts/${encodeURIComponent(draftId)}/fields/${encodeURIComponent(fieldPath)}/resolve`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      accessToken,
    }
  );
}

export async function discardJobImportDraft(
  accessToken: string,
  draftId: string
): Promise<JobImportDraft> {
  return requestJson<JobImportDraft>(
    `/job-imports/drafts/${encodeURIComponent(draftId)}/discard`,
    { method: "POST", accessToken }
  );
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
  return requestJson(
    `/job-imports/drafts/${encodeURIComponent(draftId)}/apply`,
    {
      method: "POST",
      body: JSON.stringify({ mode: "create_new" }),
      accessToken,
    }
  );
}
