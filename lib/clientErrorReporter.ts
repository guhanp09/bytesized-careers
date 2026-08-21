import { getBackendApiBaseUrl } from "./backendClient.ts";

export type ClientErrorBoundary =
  | "route"
  | "global"
  | "window"
  | "unhandled_rejection";

export type ClientErrorFrame = {
  file: string;
  line: number;
  column?: number;
  function?: string;
};

export type ClientErrorReport = {
  boundary: ClientErrorBoundary;
  name: string;
  digest?: string;
  release?: string;
  frames: ClientErrorFrame[];
};

type ErrorLike = {
  name?: unknown;
  digest?: unknown;
  stack?: unknown;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Pick<Response, "ok">>;

const MAX_FRAMES = 12;
const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_.$:-]{0,119}$/;
const SAFE_DIGEST = /^[A-Za-z0-9_-]{6,128}$/;
const SAFE_RELEASE = /^[A-Za-z0-9][A-Za-z0-9._-]{6,99}$/;
const SAFE_FUNCTION = /^[A-Za-z0-9_.$<>:\[\]-]{1,100}$/;
const STATIC_CHUNK = /^\/_next\/static\/chunks\/[A-Za-z0-9_./-]+\.js$/;

const asErrorLike = (value: unknown): ErrorLike =>
  typeof value === "object" && value !== null ? (value as ErrorLike) : {};

const safeName = (value: unknown) =>
  typeof value === "string" && SAFE_ERROR_NAME.test(value) ? value : "Error";

const safeOptional = (value: unknown, pattern: RegExp) =>
  typeof value === "string" && pattern.test(value) ? value : undefined;

function parseFrame(line: string): ClientErrorFrame | null {
  // Chrome: `at fn (https://host/_next/static/chunks/a.js:1:2)`
  // Firefox/WebKit: `fn@https://host/_next/static/chunks/a.js:1:2`
  // The prefix, origin, query, fragment and error message are all discarded.
  const location = line.match(
    /(https?:\/\/[^\s()]+\/_next\/static\/chunks\/[A-Za-z0-9_./-]+\.js)(?:\?[^\s():]*)?(?:#[^\s():]*)?:(\d+):(\d+)\)?$/,
  );
  if (!location) return null;

  let file: string;
  try {
    file = new URL(location[1]).pathname;
  } catch {
    return null;
  }
  if (!STATIC_CHUNK.test(file) || file.includes("..") || file.includes("//")) {
    return null;
  }

  const lineNumber = Number(location[2]);
  const column = Number(location[3]);
  if (
    !Number.isSafeInteger(lineNumber) ||
    !Number.isSafeInteger(column) ||
    lineNumber < 1 ||
    column < 1 ||
    lineNumber > 10_000_000 ||
    column > 10_000_000
  ) {
    return null;
  }

  const prefix = line.slice(0, location.index).trim();
  const functionCandidate = prefix
    .replace(/^at\s+/, "")
    .replace(/@$/, "")
    .replace(/\s*\($/, "")
    .trim();
  return {
    file,
    line: lineNumber,
    column,
    ...(SAFE_FUNCTION.test(functionCandidate) ? { function: functionCandidate } : {}),
  };
}

export function buildClientErrorReport(
  value: unknown,
  boundary: ClientErrorBoundary,
  releaseValue: unknown = process.env.NEXT_PUBLIC_RELEASE_SHA,
): ClientErrorReport {
  const error = asErrorLike(value);
  const stack = typeof error.stack === "string" ? error.stack.split(/\r?\n/) : [];
  const frames = stack
    .map(parseFrame)
    .filter((frame): frame is ClientErrorFrame => frame !== null)
    .slice(0, MAX_FRAMES);

  const digest = safeOptional(error.digest, SAFE_DIGEST);
  const release = safeOptional(releaseValue, SAFE_RELEASE);
  return {
    boundary,
    name: safeName(error.name),
    ...(digest ? { digest } : {}),
    ...(release ? { release } : {}),
    frames,
  };
}

export async function sendClientErrorReport(
  report: ClientErrorReport,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(
      `${getBackendApiBaseUrl()}/telemetry/client-errors`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
        credentials: "omit",
        cache: "no-store",
        keepalive: true,
      },
    );
    return response.ok;
  } catch {
    // Reporting a failure must never create another unhandled rejection or an
    // error-reporting loop. Platform monitoring owns a broken ingestion path.
    return false;
  }
}

const reportedErrors = new WeakSet<object>();

export function reportClientError(
  value: unknown,
  boundary: ClientErrorBoundary,
): void {
  if (typeof value === "object" && value !== null) {
    if (reportedErrors.has(value)) return;
    reportedErrors.add(value);
  }
  void sendClientErrorReport(buildClientErrorReport(value, boundary));
}
