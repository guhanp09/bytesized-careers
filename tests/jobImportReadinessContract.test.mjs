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
    "JobImportProcessOutcome",
    "JobImportProcessResponse",
    "JobImportProvenance",
    "JobImportReviewStatus",
  ]) {
    assert.match(contract, new RegExp(`export type ${typeName}`));
  }
  for (const operation of [
    "createJobImportSource",
    "createJobImportUrlSource",
    "getJobImportSource",
    "redactJobImportSource",
    "initializeJobImportDraft",
    "getJobImportDraft",
    "processJobImportDraft",
    "reviewJobImportField",
    "resolveJobImportConflict",
    "discardJobImportDraft",
    "deleteJobImportDraft",
    "applyJobImportDraft",
  ]) {
    assert.match(contract, new RegExp(`export async function ${operation}`));
  }
  assert.match(contract, /JSON\.stringify\(\{ mode: "create_new" \}\)/);
  assert.match(contract, /JSON\.stringify\(\{\}\)/);
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
  for (const decoder of ["decodeJobImportSource", "decodeJobImportDraft"]) {
    assert.match(contract, new RegExp(`export const ${decoder}`));
  }
  assert.match(contract, /Unsupported \$\{label\} state/);
  assert.match(contract, /SOURCE_PROCESSING_STATES/);
  assert.match(contract, /DRAFT_PROCESSING_STATES/);
  assert.match(contract, /PROVENANCE_STATES/);
  assert.match(contract, /REVIEW_STATES/);
  assert.match(contract, /AUTHORITY_STATES/);
});

test("structured backend errors retain machine-readable import metadata", () => {
  const client = read("lib/backendClient.ts");
  const errorClass = client.match(
    /export class BackendRequestError extends Error \{[\s\S]*?\n\}/
  );
  assert.ok(errorClass);
  assert.match(errorClass[0], /code\?: string/);
  assert.match(errorClass[0], /details\?: unknown/);
  assert.match(errorClass[0], /requestId\?: string/);
  assert.match(client, /parsed\.error\?\.code/);
  assert.match(client, /parsed\.error\?\.request_id/);
});

test("the user-facing import flow uses the private readiness substrate without provider branding", () => {
  const userFacingSource = [
    ...sourceFiles("app"),
    ...sourceFiles("components"),
  ]
    .map((filename) => readFileSync(filename, "utf8"))
    .join("\n");

  assert.match(userFacingSource, /jobImportReadiness/);
  assert.match(userFacingSource, /Create job draft/);
  assert.match(userFacingSource, /Source summary/);
  assert.match(userFacingSource, /resolveJobImportConflict/);
  assert.doesNotMatch(userFacingSource, /Create with AI/);
  assert.doesNotMatch(userFacingSource, /Process with AI/);
  assert.doesNotMatch(userFacingSource, /OpenAI|GPT-|provider selector/i);
});

test("repository dependencies contain only the approved OpenAI provider SDK", () => {
  const packageJson = read("package.json");
  const pyproject = read("backend/pyproject.toml");
  const dependencies = `${packageJson}\n${pyproject}`.toLowerCase();

  assert.match(dependencies, /openai>=/);
  for (const forbidden of [
    "\"anthropic\"",
    "langchain",
    "pinecone",
    "chromadb",
    "weaviate",
  ]) {
    assert.doesNotMatch(dependencies, new RegExp(forbidden));
  }
});
