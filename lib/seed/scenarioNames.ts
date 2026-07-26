/**
 * The six scenario names, and nothing else.
 *
 * Kept in its own tiny module so the server-only route and the client-side
 * selector can share the list without the client pulling in the adapter — and
 * therefore without pulling anything that could drag a manifest into a bundle.
 */

export const SCENARIO_NAMES = ["empty", "default", "busy", "edge", "talent", "recruiter"] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];

export const DEFAULT_SCENARIO: ScenarioName = "default";

export function isScenarioName(value: string | null | undefined): value is ScenarioName {
  return typeof value === "string" && (SCENARIO_NAMES as readonly string[]).includes(value);
}

/**
 * Resolve which scenario to show, and say why.
 *
 * Precedence is explicit because three inputs can disagree: a `?seed=` in the
 * URL, a stored preference, and the default. The URL wins — it is the most
 * deliberate of the three and the one people paste to each other — and an
 * unknown name is reported as an error rather than quietly becoming `default`,
 * which would have someone testing a dataset they did not ask for.
 */
export function resolveScenario(input: {
  query?: string | null;
  stored?: string | null;
}): { scenario: ScenarioName; source: "query" | "stored" | "default"; error: string | null } {
  const query = (input.query || "").trim();
  if (query) {
    if (isScenarioName(query)) return { scenario: query, source: "query", error: null };
    return {
      scenario: DEFAULT_SCENARIO,
      source: "default",
      error: `Unknown scenario "${query}". Known scenarios: ${SCENARIO_NAMES.join(", ")}.`,
    };
  }
  const stored = (input.stored || "").trim();
  if (stored && isScenarioName(stored)) {
    return { scenario: stored, source: "stored", error: null };
  }
  return { scenario: DEFAULT_SCENARIO, source: "default", error: null };
}
