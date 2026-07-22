import type { Job } from "./types";

export const JOB_DISCOVERY_PARAMS = [
  "role",
  "filter",
  "platform",
  "format",
  "workMode",
  "engagement",
  "compensationUnit",
  "language",
  "location",
  "start_timeframe",
] as const;

export type JobDiscoveryParam = (typeof JOB_DISCOVERY_PARAMS)[number];

export type JobDiscoveryState = Record<JobDiscoveryParam, string[]>;

export const splitDiscoveryValues = (value?: string | null) => {
  const seen = new Set<string>();
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export function parseJobDiscovery(source: Pick<URLSearchParams, "get">): JobDiscoveryState {
  return Object.fromEntries(
    JOB_DISCOVERY_PARAMS.map((key) => [key, splitDiscoveryValues(source.get(key))]),
  ) as JobDiscoveryState;
}

export function activeJobDiscoveryCount(state: JobDiscoveryState) {
  return JOB_DISCOVERY_PARAMS.reduce((count, key) => count + state[key].length, 0);
}

export function updateJobDiscoveryQuery(
  source: Pick<URLSearchParams, "toString">,
  param: JobDiscoveryParam,
  values: readonly string[],
) {
  const next = new URLSearchParams(source.toString());
  const normalized = splitDiscoveryValues(values.join(","));
  if (normalized.length) next.set(param, normalized.join(","));
  else next.delete(param);
  if (param === "role" && normalized.length) next.delete("filter");
  if (param === "filter" && normalized.length) next.delete("role");
  return next;
}

export function toggleJobDiscoveryQuery(
  source: Pick<URLSearchParams, "get" | "toString">,
  param: JobDiscoveryParam,
  value: string,
) {
  const current = splitDiscoveryValues(source.get(param));
  const folded = value.toLocaleLowerCase();
  const exists = current.some((item) => item.toLocaleLowerCase() === folded);
  const next = exists ? current.filter((item) => item.toLocaleLowerCase() !== folded) : [...current, value];
  return updateJobDiscoveryQuery(source, param, next);
}

export function clearJobDiscoveryQuery(source: Pick<URLSearchParams, "toString">, preserveSearch = true) {
  const next = new URLSearchParams(source.toString());
  JOB_DISCOVERY_PARAMS.forEach((key) => next.delete(key));
  if (!preserveSearch) next.delete("q");
  return next;
}

export const roleSlugFromName = (value?: string | null) =>
  (value || "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const includesFolded = (values: readonly string[], selected: readonly string[]) => {
  if (!selected.length) return true;
  const candidates = new Set(values.map((value) => value.trim().toLocaleLowerCase()).filter(Boolean));
  return selected.some((value) => candidates.has(value.toLocaleLowerCase()));
};

export function jobMatchesDiscovery(job: Job, state: JobDiscoveryState) {
  if (state.role.length && !includesFolded([roleSlugFromName(job.primaryRoleName)], state.role)) return false;
  if (state.filter.length && !includesFolded([job.legacyCategory || job.category], state.filter)) return false;
  if (state.platform.length && !includesFolded(job.platforms?.length ? job.platforms : [job.platform || ""], state.platform)) return false;
  if (state.format.length && !includesFolded(job.formatsHiredFor || [], state.format)) return false;
  if (state.workMode.length && !includesFolded([job.workMode || ""], state.workMode)) return false;
  if (state.engagement.length && !includesFolded([job.engagementType || ""], state.engagement)) return false;
  if (state.compensationUnit.length && !includesFolded([job.budgetUnit || ""], state.compensationUnit)) return false;
  if (state.location.length) {
    const location = (job.location || "").toLocaleLowerCase();
    if (!state.location.some((value) => location.includes(value.toLocaleLowerCase()))) return false;
  }
  if (state.start_timeframe.length && !includesFolded([job.startTimeframe || ""], state.start_timeframe)) return false;
  if (state.language.length) {
    const canonical = job.languageRequirements;
    const required = canonical === null || canonical === undefined
      ? job.languages || []
      : canonical.filter((item) => item.priority === "required").map((item) => item.language);
    if (!includesFolded(required, state.language)) return false;
  }
  return true;
}
