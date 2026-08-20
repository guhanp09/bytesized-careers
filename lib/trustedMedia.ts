type MediaEnvironment = Readonly<Record<string, string | undefined>>;

export type TrustedMediaRemotePattern = {
  protocol: "http" | "https";
  hostname: string;
  port: string;
  pathname: string;
  search: "";
};

export type TrustedMediaConfiguration = {
  origin: string;
  pathnamePrefix: string;
  remotePatterns: TrustedMediaRemotePattern[];
};

const MEDIA_KINDS = ["avatars", "banners"] as const;
const MEDIA_EXTENSIONS = ["gif", "jpg", "png", "webp"] as const;
const STORED_MEDIA_KEY = /^(?:avatars|banners)\/[0-9a-f]{32}\/[0-9a-f]{16}\.(?:gif|jpg|png|webp)$/;
const CONFIGURATION_METACHARACTERS = /[?#[\]{}*\\]/;
const ENCODED_SEPARATOR_OR_DOT = /%(?:2e|2f|5c)/i;

export function isStrictProductionEnvironment(environment: MediaEnvironment): boolean {
  const explicit = (environment.APP_ENV || environment.NEXT_PUBLIC_APP_ENV || "").trim();
  if (explicit) return explicit === "production";
  return environment.VERCEL_ENV === "production";
}

function invalid(reason: string): never {
  throw new Error(`Unsafe media optimizer configuration: ${reason}`);
}

function normalizedMediaPath(value: string | undefined): string {
  const configured = (value || "/media").trim();
  if (!configured.startsWith("/")) {
    invalid("MEDIA_BASE_PATH must be an absolute URL path.");
  }
  if (
    configured === "/" ||
    configured.includes("//") ||
    configured.split("/").includes("..") ||
    CONFIGURATION_METACHARACTERS.test(configured) ||
    ENCODED_SEPARATOR_OR_DOT.test(configured)
  ) {
    invalid("MEDIA_BASE_PATH must name one plain, non-root path prefix.");
  }
  return configured.replace(/\/+$/, "");
}

export function trustedMediaConfiguration(
  environment: MediaEnvironment,
): TrustedMediaConfiguration | null {
  const configured = (environment.MEDIA_PUBLIC_BASE_URL || "").trim();
  if (!configured) return null;
  if (/\s/.test(configured) || CONFIGURATION_METACHARACTERS.test(configured)) {
    invalid("MEDIA_PUBLIC_BASE_URL contains forbidden characters.");
  }

  let base: URL;
  try {
    base = new URL(configured);
  } catch {
    invalid("MEDIA_PUBLIC_BASE_URL must be an absolute HTTP(S) URL.");
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    invalid("MEDIA_PUBLIC_BASE_URL must use HTTP(S).");
  }
  if (isStrictProductionEnvironment(environment) && base.protocol !== "https:") {
    invalid("MEDIA_PUBLIC_BASE_URL must use HTTPS in production.");
  }
  if (!base.hostname || base.username || base.password || base.search || base.hash) {
    invalid("MEDIA_PUBLIC_BASE_URL must contain only an origin and optional path.");
  }
  if (
    base.pathname.includes("//") ||
    ENCODED_SEPARATOR_OR_DOT.test(base.pathname) ||
    CONFIGURATION_METACHARACTERS.test(base.hostname) ||
    CONFIGURATION_METACHARACTERS.test(base.pathname)
  ) {
    invalid("MEDIA_PUBLIC_BASE_URL contains an unsafe host or path.");
  }

  const basePath = base.pathname === "/" ? "" : base.pathname.replace(/\/+$/, "");
  const pathnamePrefix = `${basePath}${normalizedMediaPath(environment.MEDIA_BASE_PATH)}`;
  const protocol = base.protocol.slice(0, -1) as "http" | "https";
  const patternFor = (
    kind: (typeof MEDIA_KINDS)[number],
    extension: (typeof MEDIA_EXTENSIONS)[number],
  ): TrustedMediaRemotePattern => ({
    protocol,
    hostname: base.hostname,
    port: base.port,
    // Exactly owner-id / random-token / allowed raster extension. Segment
    // lengths are checked by isTrustedStoredMediaUrl before a page opts in;
    // Next's pattern language supplies the independent no-extra-path bound.
    pathname: `${pathnamePrefix}/${kind}/*/*.${extension}`,
    search: "",
  });

  return {
    origin: base.origin,
    pathnamePrefix,
    remotePatterns: MEDIA_KINDS.flatMap((kind) =>
      MEDIA_EXTENSIONS.map((extension) => patternFor(kind, extension)),
    ),
  };
}

export function isTrustedStoredMediaUrl(
  value: string | null | undefined,
  configuration: TrustedMediaConfiguration | null,
): boolean {
  if (!value || !configuration) return false;
  let candidate: URL;
  try {
    candidate = new URL(value);
  } catch {
    return false;
  }
  if (
    candidate.origin !== configuration.origin ||
    candidate.username ||
    candidate.password ||
    candidate.search ||
    candidate.hash ||
    ENCODED_SEPARATOR_OR_DOT.test(candidate.pathname)
  ) {
    return false;
  }
  const prefix = `${configuration.pathnamePrefix}/`;
  if (!candidate.pathname.startsWith(prefix)) return false;
  return STORED_MEDIA_KEY.test(candidate.pathname.slice(prefix.length));
}
