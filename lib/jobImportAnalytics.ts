/**
 * Provider-neutral, privacy-bounded analytics for the unified job-import flow.
 *
 * No vendor is installed here. A deliberate adapter may install a sink later.
 * Payloads accept only enums, counts, booleans, and durations: never source
 * text, evidence quotations, question wording, names, URLs, or job content.
 */

export type JobImportEventName =
  | "job_import.started"
  | "job_import.completed"
  | "job_import.failed"
  | "job_import.inferred_value_changed"
  | "job_import.draft_published";

export type JobImportSourceKind = "text" | "url";
export type JobImportDecisionOrigin =
  | "explicit"
  | "contextual_inference"
  | "semantic_inference"
  | "suggestion"
  | "unknown";
export type JobImportDecisionConfidence = "high" | "medium" | "low";

export type JobImportEventPayload = {
  sourceType?: JobImportSourceKind;
  durationMs?: number;
  explicitCount?: number;
  inferredCount?: number;
  suggestedCount?: number;
  reviewCount?: number;
  missingCount?: number;
  origin?: JobImportDecisionOrigin;
  confidence?: JobImportDecisionConfidence;
  removed?: boolean;
};

export type JobImportEvent = {
  name: JobImportEventName;
  payload: JobImportEventPayload;
  at: number;
};

export type JobImportAnalyticsSink = (event: JobImportEvent) => void;

const noopSink: JobImportAnalyticsSink = () => {};
let sink: JobImportAnalyticsSink = noopSink;

export function setJobImportAnalyticsSink(next: JobImportAnalyticsSink | null): void {
  sink = next ?? noopSink;
}

export function trackJobImportEvent(
  name: JobImportEventName,
  payload: JobImportEventPayload = {}
): void {
  try {
    sink({ name, payload, at: Date.now() });
  } catch {
    // Product behavior must never depend on an analytics adapter.
  }
}

export function jobImportValueWasRemoved(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
