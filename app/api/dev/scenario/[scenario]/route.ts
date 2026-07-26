import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { isProductionRuntime } from "../../../../../lib/backendClient";
import { SCENARIO_NAMES, type ScenarioName } from "../../../../../lib/seed/scenarioNames";

/**
 * Server-only loader for a generated scenario manifest.
 *
 * This route is the production-bundle boundary, and it is a boundary by
 * *construction* rather than by convention: the manifests are read from disk
 * with `node:fs`, so they can never be bundled into a client chunk no matter
 * what a component imports. Hiding the Mock toggle would not have achieved
 * that — the JSON would still have been in the download.
 *
 * It is also not a public endpoint. Outside development it 404s, using the same
 * server-computed environment check the rest of the dev surface uses, so a
 * deployed build has no route to fetch seed data from at all.
 */

export const dynamic = "force-dynamic";

const MANIFEST_DIR = path.join(process.cwd(), "fixtures", "creator_scenarios", "generated");

export async function GET(
  _request: Request,
  context: { params: Promise<{ scenario: string }> }
) {
  // Same gate as every other dev route: the client cannot read APP_ENV, so the
  // decision is made server-side where the value is trustworthy.
  if (isProductionRuntime()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { scenario } = await context.params;

  // An unknown name is an error, never a fallback to `default`. Silently
  // serving a different dataset than the one asked for is how a QA session
  // ends up reporting a bug against data it was never looking at.
  if (!SCENARIO_NAMES.includes(scenario as ScenarioName)) {
    return NextResponse.json(
      {
        error: `Unknown scenario "${scenario}".`,
        known: SCENARIO_NAMES,
      },
      { status: 400 }
    );
  }

  try {
    // `scenario` is checked against the known list above, so it cannot traverse.
    const payload = await readFile(path.join(MANIFEST_DIR, `${scenario}.json`), "utf8");
    return new NextResponse(payload, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        // Manifests only change when they are regenerated, and a stale one
        // during a QA session is worse than a re-read.
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      {
        error: `Scenario "${scenario}" has no generated manifest.`,
        hint: "Run: cd backend && .venv/bin/python -m app.db.creator_scenarios",
      },
      { status: 500 }
    );
  }
}
