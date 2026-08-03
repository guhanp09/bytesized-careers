import { JOB_FIELD_REGISTRY, type JobFieldName } from "./jobFieldRegistry.ts";

const IMPORT_TO_NATIVE_FIELD: Readonly<Record<string, JobFieldName>> = {
  primary_role_key: "primary_role_id",
};

export function nativeFieldForImport(fieldPath: string): JobFieldName | null {
  if (fieldPath in IMPORT_TO_NATIVE_FIELD) return IMPORT_TO_NATIVE_FIELD[fieldPath];
  return fieldPath in JOB_FIELD_REGISTRY ? (fieldPath as JobFieldName) : null;
}

export function importFieldLabel(fieldPath: string): string {
  const native = nativeFieldForImport(fieldPath);
  return native
    ? JOB_FIELD_REGISTRY[native].label
    : fieldPath.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
