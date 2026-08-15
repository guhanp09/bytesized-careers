/**
 * Whether a stored link may be handed to the browser as somewhere to go.
 *
 * Storage validation and render safety are separate contracts on purpose, and
 * this is the second one. Rows written before the storage validator existed can
 * hold anything — `javascript:alert(1)` is a perfectly ordinary string in a
 * database column — so the render layer cannot assume the write layer already
 * cleaned it. It has to fail closed on its own, for data it did not write.
 *
 * Returning `undefined` rather than a placeholder is deliberate. An `<a>` with
 * no `href` is inert and still shows its text, so a creator whose old link is
 * unusable sees their portfolio entry rather than a broken page or a link that
 * silently goes somewhere else.
 */

const SAFE_SCHEMES = new Set(["http:", "https:"]);

/**
 * A stored URL as an `href`, or `undefined` when it cannot be one.
 *
 * Use this at every sink that turns stored text into navigation. The value is
 * checked here rather than trusted from the API, because "the backend validates
 * it now" is only true for rows written after it started to.
 */
export function safeExternalHref(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const candidate = value.trim();
  if (!candidate) return undefined;

  let parsed: URL;
  try {
    // Absolute only. A relative value in a field meant for someone's own site
    // would resolve against CreatorJobs, which is never what it meant.
    parsed = new URL(candidate);
  } catch {
    return undefined;
  }

  if (!SAFE_SCHEMES.has(parsed.protocol)) return undefined;
  // Credentials in a link shown to someone else are either a mistake or an
  // attempt to make the destination read as a different host.
  if (parsed.username || parsed.password) return undefined;
  if (!parsed.hostname) return undefined;

  return parsed.toString();
}

/**
 * The same decision for an image source.
 *
 * Separate from the href helper because the sinks are not interchangeable: a
 * `data:` image is merely inline bytes, while a `data:` href is a navigation to
 * attacker-authored markup carrying this origin. Today both accept exactly
 * http(s), and keeping them distinct means loosening one later cannot silently
 * loosen the other.
 */
export function safeExternalImageSrc(value: unknown): string | undefined {
  return safeExternalHref(value);
}
