import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("P0 taxonomies expose creator-economy compensation and engagement values", () => {
  const contract = read("lib/jobContract.ts");
  for (const unit of [
    "per hour",
    "per day",
    "per deliverable",
    "per video",
    "per short",
    "per thumbnail",
    "per script",
    "per episode",
    "per post",
    "per project",
    "per week",
    "per month",
    "per year",
    "commission",
    "mixed",
    "custom",
  ]) {
    assert.match(contract, new RegExp(`"${unit}"`));
  }
  for (const engagement of [
    "one_time_project",
    "ongoing_freelance",
    "retainer",
    "part_time",
    "full_time",
    "fixed_term",
    "internship",
  ]) {
    assert.match(contract, new RegExp(`"${engagement}"`));
  }
});

test("draft and publish writes share one complete payload builder", () => {
  const page = read("components/PostJobPage.tsx");
  assert.equal(
    (page.match(/const buildCompleteJobPayload\s*=/g) || []).length,
    1,
    "there should be exactly one complete job payload definition",
  );
  assert.equal(
    (page.match(/buildCompleteJobPayload\(/g) || []).length,
    2,
    "publish and save should share the one canonical builder",
  );
  assert.match(page, /buildCompleteJobPayload\("published", effectiveCompensationMode\)/);
  assert.match(page, /buildCompleteJobPayload\(saveStatus, compensationMode \|\| null\)/);
  assert.doesNotMatch(page, /importGuidance|commitImportedGuidanceTurn/);

  const builder = page.match(
    /const buildCompleteJobPayload\s*=\s*\([\s\S]*?\n  \};\n\n  const payloadForWrite/,
  );
  assert.ok(builder, "complete payload builder should precede the write filter");
  for (const pattern of [
    /title:\s*title\.trim\(\)/,
    /\.\.\.buildCanonicalJobContractPayload\(/,
    /platforms:\s*selectedJobPlatforms/,
    /application_requirements:\s*sanitizedApplicationRequirements/,
    /hiring_identity_id:\s*selectedHiringIdentityId \|\| null/,
    /status,/,
  ]) {
    assert.match(builder[0], pattern);
  }
});

test("editing an existing listing PATCHes only explicitly touched payload fields", () => {
  const page = read("components/PostJobPage.tsx");

  assert.match(page, /dirtyPayloadKeysRef = useRef<Set<keyof BackendCreateJobPayload>>\(new Set\(\)\)/);
  assert.match(page, /const markPayloadDirty = useCallback\(\(\.\.\.keys: Array<keyof BackendCreateJobPayload>\)/);
  assert.match(page, /keys\.forEach\(\(key\) => dirtyPayloadKeysRef\.current\.add\(key\)\)/);
  assert.match(page, /dirtyPayloadKeysRef\.current\.clear\(\)/);
  assert.match(page, /setDomain\(\(previous\) => \(\{ \.\.\.previous, \.\.\.patch \}\)\)/);
  assert.match(page, /markPayloadDirty\(\.\.\.payloadKeys\)/);

  const partial = page.match(
    /const payloadForWrite = \(complete: BackendCreateJobPayload\)[\s\S]*?\n  \};/,
  );
  assert.ok(partial, "payloadForWrite should exist");
  assert.match(partial[0], /if \(!draftId\) return complete/);
  assert.match(partial[0], /const partial: Partial<BackendCreateJobPayload> = \{ status: complete\.status \}/);
  assert.match(partial[0], /dirtyPayloadKeysRef\.current\.forEach/);
  assert.match(partial[0], /Object\.prototype\.hasOwnProperty\.call\(complete, key\)/);
  assert.match(partial[0], /Object\.assign\(partial, \{ \[key\]: complete\[key\] \}\)/);

  assert.doesNotMatch(page, /compensationDraftFingerprint|shouldWriteCompensation/);
});

test("canonical fields serialize independently instead of reusing legacy meanings", () => {
  const page = read("components/PostJobPage.tsx");
  const contractBuilder = page.match(
    /const buildCanonicalJobContractPayload[\s\S]*?\n  \};\n\n  const buildCompleteJobPayload/,
  );
  assert.ok(contractBuilder);

  for (const pattern of [
    /\.\.\.serializeJobPostingDomain\(domain\)/,
    /primary_role_id:\s*primaryRoleId \|\| null/,
    /engagement_type:\s*engagementType \|\| null/,
    /required_tool_keys:\s*toolsConfirmed \? normalizedTools\.requiredToolKeys : null/,
    /other_required_tools:\s*toolsConfirmed \? normalizedTools\.otherRequiredTools : null/,
    /expected_weekly_hours_min:\s*parseWholeNumber\(expectedWeeklyHoursMin\)/,
    /expected_weekly_hours_max:\s*parseWholeNumber\(expectedWeeklyHoursMax\)/,
    /turnaround_value:\s*turnaround\?\.value \|\| null/,
    /turnaround_unit:\s*turnaround\?\.unit \|\| null/,
    /turnaround_basis:\s*turnaround\?\.basis \|\| null/,
  ]) {
    assert.match(contractBuilder[0], pattern);
  }

  assert.doesNotMatch(page, /contract_type:\s*budgetUnit/);
  assert.doesNotMatch(page, /weekly_hours:\s*turnaround/);
  assert.doesNotMatch(page, /engagement_type:\s*budgetUnit/);
  assert.doesNotMatch(page, /is_verified:\s*verified/);
});

test("fresh and legacy-hydrated state never invent role, engagement, or compensation values", () => {
  const page = read("components/PostJobPage.tsx");
  const client = read("lib/backendClient.ts");

  for (const pattern of [
    /const \[primaryRoleId, setPrimaryRoleId\] = useState\(""\)/,
    /const \[budgetUnit, setBudgetUnit\] = useState<CompensationUnit \| "">\(""\)/,
    /const \[budgetCurrency, setBudgetCurrency\] = useState\(""\)/,
    /const \[compensationMode, setCompensationMode\] = useState<CompensationMode \| "">\(""\)/,
    /const \[engagementType, setEngagementType\] = useState<EngagementType \| "">\(""\)/,
  ]) {
    assert.match(page, pattern);
  }

  assert.match(page, /setPrimaryRoleId\(typeof draft\.primary_role_id === "string" \? draft\.primary_role_id : ""\)/);
  assert.match(page, /const nextBudgetUnit: CompensationUnit \| "" = hasSupportedBudgetUnit[\s\S]*:\s*""/);
  assert.match(page, /setLegacyBudgetUnit\([\s\S]*draft\.budget_unit[\s\S]*:\s*null/);
  assert.match(page, /ENGAGEMENT_TYPES\.includes\(draft\.engagement_type as EngagementType\)[\s\S]*:\s*""/);
  assert.doesNotMatch(page, /setPrimaryRoleId\([^)]*(?:category|Editing)/);
  assert.doesNotMatch(page, /setEngagementType\([^)]*(?:budget_unit|contract_type)/);
  assert.doesNotMatch(page, /category:\s*"Editing"\s*,/);
  assert.doesNotMatch(page, /setJobCategory\(/);
  assert.doesNotMatch(client, /if \(!value\) return "Editing"/);
  assert.match(client, /"Uncategorized"/);
});

test("tool display names are converted to stable catalog keys", () => {
  const contract = read("lib/jobContract.ts");
  const catalog = read("lib/toolCatalog.ts");
  assert.match(catalog, /key:\s*logoKey/);
  assert.match(contract, /selectedToolKeys\.add\(entry\.key\)/);
  assert.match(contract, /TOOL_CATALOG\.filter/);
  assert.match(contract, /otherRequiredTools\.push\(value\)/);
});
