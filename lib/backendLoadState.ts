export type BackendLoadState<T> =
  | { kind: "auth" }
  | { kind: "error" }
  | { kind: "ready"; data: T };

export function hasBackendSessionAuthError(session?: { backendAuthError?: string | null } | null): boolean {
  return Boolean(session?.backendAuthError);
}

export function isBackendLoadAuthError(error: unknown): boolean {
  const status = typeof error === "object" && error !== null && "status" in error
    ? (error as { status?: unknown }).status
    : undefined;
  if (status === 401 || status === 403) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const normalized = error.message.toLowerCase();
  return (
    normalized.includes("invalid or expired token") ||
    normalized.includes("not authenticated") ||
    normalized.includes("could not validate credentials") ||
    normalized.includes("credentials")
  );
}

export function classifyBackendLoadResult<T>(
  result: PromiseSettledResult<T>,
  sessionAuthError = false
): BackendLoadState<T> {
  if (sessionAuthError) return { kind: "auth" };
  if (result.status === "fulfilled") return { kind: "ready", data: result.value };
  return isBackendLoadAuthError(result.reason) ? { kind: "auth" } : { kind: "error" };
}

export function classifyBackendLoadResults<T extends readonly unknown[]>(
  results: { [K in keyof T]: PromiseSettledResult<T[K]> },
  sessionAuthError = false
): BackendLoadState<T> {
  if (sessionAuthError) return { kind: "auth" };

  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (rejected.some((result) => isBackendLoadAuthError(result.reason))) {
    return { kind: "auth" };
  }
  if (rejected.length) return { kind: "error" };

  return {
    kind: "ready",
    data: results.map((result) => (result as PromiseFulfilledResult<unknown>).value) as unknown as T,
  };
}
