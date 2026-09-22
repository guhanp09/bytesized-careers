import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const extractSteps = (source) => {
  const match = source.match(/const STEPS: Array<\{ id: Step; label: string \}> = \[([\s\S]*?)\];/);
  assert.ok(match, "PostTalentPage should declare the Post Talent step order");
  return Array.from(match[1].matchAll(/id:\s*"([^"]+)"/g)).map((entry) => entry[1]);
};

const extractBranch = (source, step, nextStep) => {
  const pattern = nextStep
    ? new RegExp(`if \\(step === "${step}"\\) \\{([\\s\\S]*?)if \\(step === "${nextStep}"\\) \\{`)
    : new RegExp(`if \\(step === "${step}"\\) \\{([\\s\\S]*?)return \\(\\s*<StepShell title="Hiring requests"`);
  const match = source.match(pattern);
  assert.ok(match, `${step} branch should exist`);
  return match[1];
};

test("post-talent uses the six-step structural flow", () => {
  const page = read("components/PostTalentPage.tsx");
  const steps = extractSteps(page);

  assert.deepEqual(steps, [
    "basics",
    "details",
    "services",
    "creatorContext",
    "toolsPortfolio",
    "hiringRequests",
  ]);

  for (const oldStep of ["focus", "collaboration", "proof", "preview", "publish"]) {
    assert.equal(steps.includes(oldStep), false);
  }
});

test("post-talent basics contains core facts and preserves an existing listing's currency", () => {
  const page = read("components/PostTalentPage.tsx");
  const basics = extractBranch(page, "basics", "details");

  for (const label of [
    "Listing headline",
    "Primary role",
    "Years of experience",
    "Work mode",
    "Location",
    "Rate",
  ]) {
    assert.match(basics, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  // New listings still default to INR, but an existing USD/EUR listing must
  // keep and display its stored currency when edited. The old fixed-INR
  // assertion encoded the data-loss bug this contract now prevents.
  assert.match(basics, /rateCurrencyMark/);
  assert.match(basics, /Contact for pricing/);
  assert.match(basics, /Flexible/);
  assert.doesNotMatch(basics, /Rate intent/);
  assert.match(page, /useState\("INR"\)/);
  assert.match(page, /setRateCurrency\(listing\.rate_currency/);
  assert.match(page, /rate_currency:\s*normalizedRateCurrency/);
  assert.doesNotMatch(page, /label="Currency"|>\s*Currency\s*</);
  assert.doesNotMatch(basics, /Timezone|Turnaround|ToolPicker|RequirementSelector/);
});

test("post-talent details, services, context, portfolio, and requests are separated", () => {
  const page = read("components/PostTalentPage.tsx");
  const details = extractBranch(page, "details", "services");
  const services = extractBranch(page, "services", "creatorContext");
  const creatorContext = extractBranch(page, "creatorContext", "toolsPortfolio");
  const toolsPortfolio = extractBranch(page, "toolsPortfolio", null);
  const hiringRequests = page.match(/<StepShell title="Hiring requests"([\s\S]*?)<\/StepShell>/);

  assert.match(details, /Turnaround/);
  assert.match(details, /Timezone/);
  assert.match(details, /LanguagePicker/);
  assert.match(details, /idPrefix="post-talent"[\s\S]*enableGlobalPicker/);

  assert.match(services, /Roles/);
  assert.match(services, /Services offered/);
  assert.match(services, /ServicesBulletEditor/);
  assert.doesNotMatch(services, /<textarea/);
  assert.doesNotMatch(services, /Content niches|ToolPicker|RequirementSelector/);

  assert.match(creatorContext, /Content niches/);
  assert.match(creatorContext, /Genres/);
  assert.match(creatorContext, /Formats offered/);
  assert.match(creatorContext, /Platforms/);
  assert.match(creatorContext, /icon="sparkles"/);
  assert.match(creatorContext, /icon="layers"/);
  assert.match(creatorContext, /icon="layout-grid"/);
  assert.equal(creatorContext.includes("rounded-2xl border border-white/[0.08]"), false);
  assert.doesNotMatch(creatorContext, /ToolPicker|RequirementSelector/);

  assert.match(toolsPortfolio, /ToolPicker/);
  assert.match(toolsPortfolio, /inputId="post-talent-tools-picker"/);
  assert.match(toolsPortfolio, /className="space-y-2"/);
  assert.match(toolsPortfolio, /Public portfolio\/work samples/);

  assert.ok(hiringRequests, "Hiring requests branch should render the final step");
  assert.match(hiringRequests[1], /What recruiters must include/);
  assert.match(hiringRequests[1], /RequirementSelector/);
  assert.match(hiringRequests[1], /customInstructionValue=\{firstMessageCustomInstruction\}/);
});

test("post-talent completion and legacy draft targets route to the new steps", () => {
  const page = read("components/PostTalentPage.tsx");

  assert.match(page, /experience:\s*\{\s*step:\s*"basics"/);
  assert.match(page, /collaboration:\s*\{\s*step:\s*"basics"/);
  assert.match(page, /tools:\s*\{\s*step:\s*"toolsPortfolio"/);
  assert.match(page, /portfolio:\s*\{\s*step:\s*"toolsPortfolio"/);
  assert.match(page, /creatorContext:\s*\{\s*step:\s*"creatorContext"/);
  assert.match(page, /description:\s*\{\s*step:\s*"services"/);
  assert.match(page, /"talent-first-message":\s*\{\s*step:\s*"hiringRequests"/);

  assert.match(page, /focus:\s*"creatorContext"/);
  assert.match(page, /proof:\s*"toolsPortfolio"/);
  assert.match(page, /preview:\s*"hiringRequests"/);
  assert.match(page, /publish:\s*"hiringRequests"/);
});
