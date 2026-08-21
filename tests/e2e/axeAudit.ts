import fs from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";

const AXE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "node_modules", "axe-core", "axe.min.js"),
  "utf8"
);

const WCAG_AA_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22a",
  "wcag22aa",
] as const;

export type AxeViolation = {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  nodes: Array<{
    target: string[];
    html: string;
    failureSummary?: string;
  }>;
};

/**
 * Let finite entry animations reach their real rendered opacity before axe
 * measures contrast. Infinite decoration is deliberately ignored: waiting for
 * a spinner or pulse would turn an accessibility assertion into a timeout.
 */
export async function settleForAccessibility(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) => {
      const timing = animation.effect?.getTiming();
      return timing?.iterations !== Infinity;
    });
    await Promise.race([
      Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, 1_500)),
    ]);
  });
}

/** Run the declared WCAG 2.x A/AA rules against the complete document. */
export async function auditDocument(page: Page): Promise<AxeViolation[]> {
  await settleForAccessibility(page);
  const installed = await page.evaluate(() => "axe" in window);
  if (!installed) await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async (tags) => {
    type RuntimeViolation = AxeViolation;
    type AxeRuntime = {
      run: (
        context: Document,
        options: {
          runOnly: { type: "tag"; values: string[] };
          resultTypes: ["violations"];
        }
      ) => Promise<{ violations: RuntimeViolation[] }>;
    };
    const axe = (window as typeof window & { axe: AxeRuntime }).axe;
    const results = await axe.run(document, {
      runOnly: { type: "tag", values: [...tags] },
      // axe still executes every selected rule. This only avoids serializing
      // pass/incomplete node detail that this fail-closed gate never consumes.
      resultTypes: ["violations"],
    });
    return results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        html: node.html,
        failureSummary: node.failureSummary,
      })),
    }));
  }, WCAG_AA_TAGS);
}

function formatViolations(label: string, violations: AxeViolation[]): string {
  const details = violations.map((violation) => {
    const nodes = violation.nodes
      .map(
        (node) =>
          `    ${node.target.join(" ")}\n` +
          `      ${node.failureSummary ?? violation.help}\n` +
          `      ${node.html}`
      )
      .join("\n");
    return `  ${violation.id} [${violation.impact ?? "unknown"}] — ${violation.help}\n${nodes}\n    ${violation.helpUrl}`;
  });
  return `axe found ${violations.length} WCAG A/AA violation${violations.length === 1 ? "" : "s"} in ${label}:\n${details.join("\n")}`;
}

/**
 * Fail on every selected WCAG violation, irrespective of axe impact label.
 * Impact is triage metadata, not permission to ship a known A/AA failure.
 */
export async function expectAxeClean(page: Page, label: string): Promise<void> {
  const violations = await auditDocument(page);
  if (violations.length > 0) throw new Error(formatViolations(label, violations));
}
