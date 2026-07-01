"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { DEV_PERSONA_PASSWORD } from "../../lib/devTools";
import {
  WORKFLOW_ACTIONS,
  getWorkflowAction,
  summarizeWorkflow,
  type WorkflowActionId,
  type WorkflowResult,
} from "../../lib/devWorkflows";

// Internal-only dev tool. Switches personas (real credentials sign-in), seeds
// realistic data, runs real cross-persona marketplace workflows, and resets local
// dev data. Rendered only when the server layout decides the environment is
// dev/test, so it never ships in production output.

type Persona = {
  key: string;
  label: string;
  email: string;
  accountType: string;
  description: string;
};

type DevStatus = {
  env: string;
  personaCount: number;
  users: number;
  jobs: number;
  talentListings: number;
  applications: number;
  notifications: number;
};

type SeedScenario = { id: string; label: string };

const SEED_BUTTONS: SeedScenario[] = [
  { id: "marketplace", label: "Marketplace" },
  { id: "applications", label: "Applications" },
  { id: "drafts", label: "Drafts" },
  { id: "full_demo", label: "Full demo" },
];

type Busy =
  | null
  | { kind: "personas" }
  | { kind: "switch"; key: string }
  | { kind: "seed"; id: string }
  | { kind: "reset" }
  | { kind: "workflow" };

export default function DevToolsPanel() {
  const { data: session } = useSession();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [status, setStatus] = useState<DevStatus | null>(null);
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const [workflowId, setWorkflowId] = useState<WorkflowActionId>("apply-to-job");
  const [workflowResult, setWorkflowResult] = useState<WorkflowResult | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/dev/status", { cache: "no-store" });
      if (res.ok) {
        setStatus((await res.json()) as DevStatus);
        setBackendReachable(true);
      } else {
        setBackendReachable(false);
      }
    } catch {
      setBackendReachable(false);
    }
  }, []);

  const loadPersonas = useCallback(async () => {
    setBusy({ kind: "personas" });
    try {
      const res = await fetch("/api/dev/personas", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { personas?: Persona[] };
        setPersonas(Array.isArray(data.personas) ? data.personas : []);
        setBackendReachable(true);
      } else {
        setBackendReachable(false);
        setMessage("Dev backend unreachable. Start it with APP_ENV=development.");
      }
    } catch {
      setBackendReachable(false);
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadPersonas();
    void refreshStatus();
  }, [open, loadPersonas, refreshStatus]);

  const switchPersona = useCallback(
    async (persona: Persona) => {
      setBusy({ kind: "switch", key: persona.key });
      setMessage(null);
      try {
        const result = await signIn("credentials", {
          redirect: false,
          email: persona.email,
          password: DEV_PERSONA_PASSWORD,
        });
        if (result?.ok) {
          setMessage(`Switched to ${persona.label}.`);
          router.refresh();
        } else {
          setMessage(
            `Could not switch. Seed personas first (Seed → Full demo), then retry. (${persona.email})`
          );
        }
      } catch {
        setMessage("Sign-in failed. Is the backend running?");
      } finally {
        setBusy(null);
      }
    },
    [router]
  );

  const runSeed = useCallback(
    async (scenario: string) => {
      setBusy({ kind: "seed", id: scenario });
      setMessage(null);
      try {
        const res = await fetch("/api/dev/seed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenario }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.ok) {
          setMessage(`Seeded: ${scenario}.`);
          await refreshStatus();
        } else {
          setMessage(data.error || `Seed failed (${res.status}).`);
        }
      } catch {
        setMessage("Seed request failed. Is the backend running?");
      } finally {
        setBusy(null);
      }
    },
    [refreshStatus]
  );

  const runReset = useCallback(async () => {
    setBusy({ kind: "reset" });
    setMessage(null);
    try {
      const res = await fetch("/api/dev/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        setMessage("Local dev data reset to baseline.");
        await refreshStatus();
        router.refresh();
      } else {
        setMessage(data.error || `Reset failed (${res.status}).`);
      }
    } catch {
      setMessage("Reset request failed. Is the backend running?");
    } finally {
      setBusy(null);
      setConfirmingReset(false);
    }
  }, [refreshStatus, router]);

  const runWorkflow = useCallback(async () => {
    const action = getWorkflowAction(workflowId);
    if (!action) return;
    setBusy({ kind: "workflow" });
    setMessage(null);
    setWorkflowResult(null);
    try {
      const res = await fetch("/api/dev/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: action.id,
          actorKey: action.actorKey,
          targetKey: action.targetKey,
          ...(action.body || {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as WorkflowResult & { error?: string };
      if (res.ok) {
        setWorkflowResult(data);
        await refreshStatus();
      } else {
        setWorkflowResult({
          action: action.id,
          ok: false,
          summary: data.error || `Workflow failed (${res.status}).`,
          actor: action.actorKey,
          target: action.targetKey,
          checks: [],
          error: data.error || `HTTP ${res.status}`,
        });
      }
    } catch {
      setWorkflowResult({
        action: action.id,
        ok: false,
        summary: "Workflow request failed. Is the backend running?",
        actor: action.actorKey,
        target: action.targetKey,
        checks: [],
        error: "network",
      });
    } finally {
      setBusy(null);
    }
  }, [workflowId, refreshStatus]);

  const currentUserId = session?.user?.backendUserId || session?.user?.userId || null;
  const currentEmail = session?.user?.email || null;
  const activePersona = personas.find((p) => p.email === currentEmail) || null;

  if (!open) {
    return (
      <button
        type="button"
        data-testid="dev-tools-open"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-24 z-[100] inline-flex h-9 items-center gap-1.5 rounded-full border border-amber-400/40 bg-[#1a1206]/95 px-3 text-xs font-semibold text-amber-200 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.9)] backdrop-blur hover:border-amber-300/70 hover:text-amber-100"
        aria-label="Open dev tools"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        Dev
      </button>
    );
  }

  return (
    <section
      data-testid="dev-tools-panel"
      className="fixed bottom-4 left-24 z-[100] w-[300px] rounded-2xl border border-amber-400/30 bg-[#0d0b07]/97 p-4 text-white shadow-[0_24px_60px_-20px_rgba(0,0,0,0.95)] backdrop-blur"
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <h2 className="text-sm font-semibold tracking-tight text-amber-100">Dev tools</h2>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-2 py-1 text-xs text-white/50 hover:bg-white/5 hover:text-white"
          aria-label="Collapse dev tools"
        >
          Hide
        </button>
      </header>
      <p className="mt-1 text-[11px] leading-4 text-amber-200/50">
        Development only. Not part of the product.
      </p>

      {/* Persona */}
      <div className="mt-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Persona</p>
        <select
          data-testid="dev-persona-select"
          className="mt-1.5 h-9 w-full rounded-lg border border-white/10 bg-white/[0.05] px-2 text-xs text-white outline-none focus:border-amber-300/40"
          value={activePersona?.key || ""}
          disabled={busy?.kind === "switch" || personas.length === 0}
          onChange={(event) => {
            const persona = personas.find((p) => p.key === event.target.value);
            if (persona) void switchPersona(persona);
          }}
        >
          <option value="" disabled>
            {personas.length === 0 ? "No personas (seed first)" : "Select a persona…"}
          </option>
          {personas.map((persona) => (
            <option key={persona.key} value={persona.key}>
              {persona.label}
            </option>
          ))}
        </select>
        {activePersona ? (
          <p className="mt-1 text-[11px] leading-4 text-white/45">{activePersona.description}</p>
        ) : null}
      </div>

      {/* Seed */}
      <div className="mt-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Seed</p>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {SEED_BUTTONS.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              data-testid={`dev-seed-${scenario.id}`}
              disabled={busy !== null}
              onClick={() => void runSeed(scenario.id)}
              className="h-8 rounded-lg border border-white/10 bg-white/[0.05] text-xs font-medium text-white/80 hover:border-white/25 hover:text-white disabled:opacity-50"
            >
              {busy?.kind === "seed" && busy.id === scenario.id ? "…" : scenario.label}
            </button>
          ))}
        </div>
      </div>

      {/* Workflow tester — real cross-persona marketplace actions */}
      <div className="mt-3" data-testid="dev-workflow-tester">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
          Workflow tester
        </p>
        <select
          data-testid="dev-workflow-select"
          className="mt-1.5 h-9 w-full rounded-lg border border-white/10 bg-white/[0.05] px-2 text-xs text-white outline-none focus:border-amber-300/40"
          value={workflowId}
          onChange={(event) => {
            setWorkflowId(event.target.value as WorkflowActionId);
            setWorkflowResult(null);
          }}
        >
          {WORKFLOW_ACTIONS.map((action) => (
            <option key={action.id} value={action.id}>
              {action.label}
              {action.supported ? "" : " (not wired)"}
            </option>
          ))}
        </select>
        {(() => {
          const action = getWorkflowAction(workflowId);
          if (!action) return null;
          return (
            <p className="mt-1 text-[11px] leading-4 text-white/45">
              {action.actorKey} → {action.targetKey}
              {action.note ? ` · ${action.note}` : ""}
            </p>
          );
        })()}
        <button
          type="button"
          data-testid="dev-workflow-run"
          disabled={busy !== null}
          onClick={() => void runWorkflow()}
          className="mt-1.5 h-8 w-full rounded-lg border border-amber-400/30 bg-amber-500/10 text-xs font-semibold text-amber-100 hover:border-amber-300/60 hover:bg-amber-500/20 disabled:opacity-50"
        >
          {busy?.kind === "workflow" ? "Running…" : "Run workflow"}
        </button>

        {workflowResult ? (
          <div
            data-testid="dev-workflow-result"
            className={`mt-2 rounded-lg border p-2 ${
              workflowResult.ok
                ? "border-emerald-400/25 bg-emerald-500/[0.07]"
                : "border-rose-400/25 bg-rose-500/[0.07]"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-white/85">
                {summarizeWorkflow(workflowResult).label}
              </span>
              <span
                data-testid="dev-workflow-status"
                className={`text-[11px] font-semibold ${
                  workflowResult.ok ? "text-emerald-300" : "text-rose-300"
                }`}
              >
                {workflowResult.ok ? "OK" : "FAIL"}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-white/55">{workflowResult.summary}</p>
            <ul className="mt-1.5 space-y-0.5">
              {workflowResult.checks.map((check, index) => (
                <li key={index} className="flex items-start gap-1.5 text-[11px] leading-4">
                  <span className={check.ok ? "text-emerald-300" : "text-rose-300"}>
                    {check.ok ? "✓" : "✗"}
                  </span>
                  <span className="text-white/70">
                    {check.label}
                    {check.detail ? <span className="text-white/40"> — {check.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            {workflowResult.links && Object.keys(workflowResult.links).length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {Object.entries(workflowResult.links).map(([label, href]) => (
                  <a
                    key={label}
                    href={href}
                    className="rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-amber-200/80 hover:text-amber-100"
                  >
                    {label}
                  </a>
                ))}
              </div>
            ) : null}
            <p className="mt-1.5 text-[10px] leading-3 text-white/35">
              Switch to the target persona to see it in the real UI.
            </p>
          </div>
        ) : null}
      </div>

      {/* Reset */}
      <div className="mt-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Reset</p>
        {confirmingReset ? (
          <div className="mt-1.5 rounded-lg border border-rose-400/30 bg-rose-500/10 p-2">
            <p className="text-[11px] leading-4 text-rose-100/90">
              Reset local dev data? This only works in development and will recreate seeded test data.
            </p>
            <div className="mt-2 flex gap-1.5">
              <button
                type="button"
                data-testid="dev-reset-confirm"
                disabled={busy?.kind === "reset"}
                onClick={() => void runReset()}
                className="h-8 flex-1 rounded-lg border border-rose-400/40 bg-rose-500/20 text-xs font-semibold text-rose-100 hover:bg-rose-500/30 disabled:opacity-50"
              >
                {busy?.kind === "reset" ? "Resetting…" : "Confirm reset"}
              </button>
              <button
                type="button"
                data-testid="dev-reset-cancel"
                onClick={() => setConfirmingReset(false)}
                className="h-8 flex-1 rounded-lg border border-white/10 bg-white/[0.05] text-xs font-medium text-white/70 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            data-testid="dev-reset"
            disabled={busy !== null}
            onClick={() => setConfirmingReset(true)}
            className="mt-1.5 h-8 w-full rounded-lg border border-rose-400/25 bg-rose-500/10 text-xs font-medium text-rose-200 hover:border-rose-400/50 hover:text-rose-100 disabled:opacity-50"
          >
            Reset dev data
          </button>
        )}
      </div>

      {/* Status */}
      <div className="mt-3 border-t border-white/10 pt-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Status</p>
        <dl className="mt-1.5 space-y-0.5 text-[11px] text-white/55">
          <div className="flex justify-between">
            <dt>Environment</dt>
            <dd className="text-white/80">{status?.env || "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Backend</dt>
            <dd className={backendReachable === false ? "text-rose-300" : "text-emerald-300"}>
              {backendReachable === null ? "…" : backendReachable ? "reachable" : "unreachable"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Current user</dt>
            <dd className="max-w-[150px] truncate text-white/80" title={currentUserId || undefined}>
              {currentEmail || (currentUserId ? currentUserId : "signed out")}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Personas seeded</dt>
            <dd className="text-white/80">{status ? status.personaCount : "—"}</dd>
          </div>
        </dl>
        {session ? (
          <button
            type="button"
            data-testid="dev-signout"
            onClick={() => void signOut({ redirect: false }).then(() => router.refresh())}
            className="mt-2 h-7 w-full rounded-lg border border-white/10 bg-white/[0.04] text-[11px] text-white/60 hover:text-white"
          >
            Sign out (reset session)
          </button>
        ) : null}
      </div>

      {message ? (
        <p data-testid="dev-tools-message" className="mt-2.5 text-[11px] leading-4 text-amber-200/80">
          {message}
        </p>
      ) : null}
    </section>
  );
}
