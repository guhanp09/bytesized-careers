import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function source(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function executableSource(path) {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/^\s*#.*$/gm, "")
    .replace(/'''[\s\S]*?'''|\"\"\"[\s\S]*?\"\"\"/g, "");
}

function section(markdown, heading) {
  const startMarker = `## ${heading}`;
  const start = markdown.indexOf(startMarker);
  assert.notEqual(start, -1, `missing runbook heading: ${heading}`);
  const next = markdown.indexOf("\n## ", start + startMarker.length);
  return markdown.slice(start, next === -1 ? undefined : next);
}

const RUNBOOKS = [
  ["rollback", "Release regression or bad release"],
  ["rollback", "Failed or incompatible database migration"],
  ["compromise", "Compromised customer account"],
  ["compromise", "Compromised administrator account"],
  ["data_loss", "Database corruption or data loss"],
  ["data_loss", "Media loss or storage failure"],
  ["abuse", "Abuse or rate-limit control outage"],
  ["provider", "Transactional email outage"],
  ["provider", "AI provider, safety, or cost incident"],
  ["provider", "Realtime or shared-state outage"],
  ["provider", "Google OAuth or YouTube incident"],
];

test("every required incident class has a CreatorJobs-specific decision path", () => {
  const runbook = source("docs/INCIDENT_RESPONSE.md");
  const classes = new Set();

  for (const [incidentClass, heading] of RUNBOOKS) {
    classes.add(incidentClass);
    const body = section(runbook, heading);
    for (const required of [
      "### Detect",
      "### Contain",
      "### Preserve",
      "### Recover",
      "### Verify",
      "### External gate",
    ]) {
      assert.match(body, new RegExp(`^${required}$`, "m"), `${heading}: ${required}`);
    }
  }

  assert.deepEqual(
    [...classes].sort(),
    ["abuse", "compromise", "data_loss", "provider", "rollback"],
  );
});

test("runbook controls have executable declarations, enforcement, and consumers", () => {
  const runbook = source("docs/INCIDENT_RESPONSE.md");
  const controls = [
    {
      name: "release migration",
      declaration: ["backend/scripts/release_migrate.py", "def sole_head("],
      enforcement: ["backend/scripts/start_render.sh", "python -m scripts.release_migrate"],
      consumer: "Failed or incompatible database migration",
    },
    {
      name: "customer session revocation",
      declaration: ["backend/app/api/v1/routers/auth.py", '"/logout-all"'],
      enforcement: ["backend/app/services/auth_service.py", "revoke_all_sessions"],
      consumer: "Compromised customer account",
    },
    {
      name: "administrator emergency revocation",
      declaration: ["backend/scripts/grant_admin.py", '"admin.role.revoke"'],
      enforcement: ["backend/scripts/grant_admin.py", "revoke_auth_sessions_for_user"],
      consumer: "Compromised administrator account",
    },
    {
      name: "administrator suspension",
      declaration: ["backend/app/api/v1/routers/admin.py", "async def admin_suspend_user("],
      enforcement: ["backend/app/api/v1/routers/admin.py", 'reason="account_suspended"'],
      consumer: "Compromised customer account",
    },
    {
      name: "AI kill switch",
      declaration: ["backend/app/core/config.py", "job_import_enabled"],
      enforcement: ["backend/app/core/job_import_availability.py", "refuse_if_disabled"],
      consumer: "AI provider, safety, or cost incident",
    },
    {
      name: "shared email delivery switch",
      declaration: ["backend/app/core/config.py", "email_delivery_enabled"],
      enforcement: ["backend/app/notifications/email.py", "real_delivery_enabled"],
      consumer: "Transactional email outage",
    },
    {
      name: "realtime failure isolation",
      declaration: ["backend/app/realtime/manager.py", "async def publish_to_user("],
      enforcement: ["backend/app/realtime/manager.py", "realtime_publish_failed"],
      consumer: "Realtime or shared-state outage",
    },
    {
      name: "Google local disconnect",
      declaration: ["backend/app/api/v1/routers/me.py", '"/youtube/disconnect"'],
      enforcement: ["backend/app/services/me_service.py", "_invalidate_youtube_authority"],
      consumer: "Google OAuth or YouTube incident",
    },
    {
      name: "owned media boundary",
      declaration: ["backend/app/services/media_storage.py", "class MediaStorage("],
      enforcement: ["backend/app/services/media_validation.py", "def prepare_upload("],
      consumer: "Media loss or storage failure",
    },
  ];

  for (const control of controls) {
    const [declarationPath, declarationToken] = control.declaration;
    const [enforcementPath, enforcementToken] = control.enforcement;
    assert.match(
      executableSource(declarationPath),
      new RegExp(declarationToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${control.name} has no executable declaration`,
    );
    assert.match(
      executableSource(enforcementPath),
      new RegExp(enforcementToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${control.name} has no executable enforcement`,
    );
    assert.match(
      section(runbook, control.consumer),
      /### Contain[\s\S]+### Preserve/,
      `${control.name} has no operator consumer`,
    );
  }
});

test("the tabletop covers every class and does not promote external drills", () => {
  const tabletop = source("docs/INCIDENT_TABLETOP.md");
  const rows = [...tabletop.matchAll(/^\| TT-(\d+) \| ([a-z_]+) \|.*\| PASS \|$/gm)];

  assert.equal(rows.length, 11);
  assert.deepEqual(
    [...new Set(rows.map((match) => match[2]))].sort(),
    ["abuse", "compromise", "data_loss", "provider", "rollback"],
  );
  assert.match(tabletop, /no-provider walkthrough/i);
  assert.match(tabletop, /does not mean a human on-call team or live recovery drill passed/i);
});

test("recovery documentation preserves external truth and safe health semantics", () => {
  const runbook = source("docs/INCIDENT_RESPONSE.md");
  const ledger = source("docs/PRODUCTION_READINESS_EXECUTION.md");

  assert.match(ledger, /\| OPS-001 \| CRITICAL \| Database backup\/PITR \|[^\n]+\| BLOCKED_EXTERNAL \|/);
  assert.match(ledger, /\| OPS-002 \| HIGH \| Media backup\/lifecycle \|[^\n]+\| BLOCKED_EXTERNAL \|/);
  assert.match(runbook, /No hosted backup or PITR restore has been run/);
  assert.match(runbook, /Only the process-local adapter exists in this repository/);
  assert.match(runbook, /current Redis limiter is not proven atomic/);

  const health = executableSource("backend/app/health/router.py");
  assert.match(health, /async def health\(\)/);
  assert.match(health, /async def health_ready\(/);
  assert.match(health, /async def health_job_import\(/);
  assert.match(health, /async def health_realtime\(/);

  const dockerfile = source("backend/Dockerfile");
  assert.match(dockerfile, /\/api\/v1\/health" \|\| exit 1/);
  assert.doesNotMatch(dockerfile, /HEALTHCHECK[^\n]+\/health\/ready/);
});

test("code blocks contain no destructive recovery shortcut or live credential", () => {
  const runbook = source("docs/INCIDENT_RESPONSE.md");
  const blocks = [...runbook.matchAll(/```(?:bash)?\n([\s\S]*?)```/g)].map((match) => match[1]);
  const commands = blocks.join("\n");

  for (const forbidden of [
    "alembic downgrade",
    "reset --hard",
    "seed_staging_demo.py --reset",
    "git push",
    "--force",
    "DROP DATABASE",
    "TRUNCATE ",
  ]) {
    assert.doesNotMatch(commands, new RegExp(forbidden, "i"), forbidden);
  }
  assert.doesNotMatch(commands, /postgres(?:ql)?:\/\/[^\s]*:[^\s]*@/i);
  assert.doesNotMatch(commands, /(?:Bearer|sk-[A-Za-z0-9_-]{8,}|BEGIN PRIVATE KEY)/);
});
