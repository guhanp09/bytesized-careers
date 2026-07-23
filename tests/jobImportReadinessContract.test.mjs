import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

const sourceFiles = (directory) =>
  readdirSync(path.join(root, directory), { recursive: true })
    .filter((entry) => /\.(?:ts|tsx|js|jsx)$/.test(entry))
    .map((entry) => path.join(root, directory, entry))
    .filter((entry) => statSync(entry).isFile());

test("job-import readiness client owns the private typed contract", () => {
  const contract = read("lib/jobImportReadiness.ts");
  for (const typeName of [
    "JobImportSourceType",
    "JobImportSource",
    "JobImportField",
    "JobImportDraft",
    "JobImportProvenance",
    "JobImportReviewStatus",
  ]) {
    assert.match(contract, new RegExp(`export type ${typeName}`));
  }
  for (const operation of [
    "createJobImportSource",
    "getJobImportSource",
    "redactJobImportSource",
    "initializeJobImportDraft",
    "getJobImportDraft",
    "reviewJobImportField",
    "resolveJobImportConflict",
    "discardJobImportDraft",
    "deleteJobImportDraft",
    "applyJobImportDraft",
  ]) {
    assert.match(contract, new RegExp(`export async function ${operation}`));
  }
  assert.match(contract, /JSON\.stringify\(\{ mode: "create_new" \}\)/);
  const sourceWrite = contract.match(
    /export type JobImportSourceCreate = \{[\s\S]*?\n\};/
  );
  const draftWrite = contract.match(
    /export type JobImportDraftInitialize = \{[\s\S]*?\n\};/
  );
  assert.ok(sourceWrite);
  assert.ok(draftWrite);
  assert.doesNotMatch(sourceWrite[0], /provider_name|model_name|instruction_version/);
  assert.doesNotMatch(draftWrite[0], /provider_name|processing_status|target_job_id/);
  assert.doesNotMatch(contract, /language_requirements|languageRequirements/);
  assert.doesNotMatch(contract, /processWithAI|runModel|generateWithAI/);
});

test("no application or component links the readiness substrate into user-facing UI", () => {
  const userFacingSource = [
    ...sourceFiles("app"),
    ...sourceFiles("components"),
  ]
    .map((filename) => readFileSync(filename, "utf8"))
    .join("\n");

  assert.doesNotMatch(userFacingSource, /jobImportReadiness/);
  assert.doesNotMatch(userFacingSource, /Create with AI/);
  assert.doesNotMatch(userFacingSource, /Process with AI/);
});

test("repository dependencies contain no model-provider or embedding SDK", () => {
  const packageJson = read("package.json");
  const pyproject = read("backend/pyproject.toml");
  const dependencies = `${packageJson}\n${pyproject}`.toLowerCase();

  for (const forbidden of [
    "\"openai\"",
    "\"anthropic\"",
    "langchain",
    "pinecone",
    "chromadb",
    "weaviate",
  ]) {
    assert.doesNotMatch(dependencies, new RegExp(forbidden));
  }
});
