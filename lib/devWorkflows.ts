// Catalog + helpers for the dev "Workflow tester" — cross-persona marketplace flows
// that exercise the real backend. Kept framework-free so the catalog and the result
// summarizer are unit-testable without a DOM.

export type WorkflowActionId =
  | "apply-to-job"
  | "send-hiring-request"
  | "reply-to-application"
  | "reply-to-hiring-request"
  | "send-message";

export type WorkflowAction = {
  id: WorkflowActionId;
  label: string;
  /** Default acting persona key. */
  actorKey: string;
  /** Default recipient persona key. */
  targetKey: string;
  /** Extra default body merged into the request (e.g. a status). */
  body?: Record<string, unknown>;
  /** False = intentionally not wired in the product (documented, never faked). */
  supported: boolean;
  note?: string;
};

export const WORKFLOW_ACTIONS: WorkflowAction[] = [
  {
    id: "apply-to-job",
    label: "Talent applies to recruiter job",
    actorKey: "talent-complete",
    targetKey: "recruiter-active",
    supported: true,
  },
  {
    id: "send-hiring-request",
    label: "Recruiter sends hiring request",
    actorKey: "recruiter-active",
    targetKey: "talent-complete",
    supported: true,
  },
  {
    id: "reply-to-application",
    label: "Recruiter replies to application",
    actorKey: "recruiter-active",
    targetKey: "talent-complete",
    body: { status: "shortlisted" },
    supported: true,
  },
  {
    id: "reply-to-hiring-request",
    label: "Talent replies to hiring request",
    actorKey: "talent-complete",
    targetKey: "recruiter-active",
    body: { status: "contacted" },
    supported: true,
  },
  {
    id: "send-message",
    label: "Send message between personas",
    actorKey: "talent-complete",
    targetKey: "recruiter-active",
    supported: true,
    note: "Sends a real message in the existing application/interest thread.",
  },
];

export const WORKFLOW_ACTION_IDS = WORKFLOW_ACTIONS.map((a) => a.id);

export const getWorkflowAction = (id: string): WorkflowAction | undefined =>
  WORKFLOW_ACTIONS.find((a) => a.id === id);

export type WorkflowCheck = { label: string; ok: boolean; detail?: string | null };

export type WorkflowResult = {
  action: string;
  ok: boolean;
  summary: string;
  actor: string;
  target: string;
  recordId?: string | null;
  conversationId?: string | null;
  checks: WorkflowCheck[];
  links?: Record<string, string>;
  error?: string;
};

export type WorkflowSummary = {
  ok: boolean;
  passed: number;
  total: number;
  label: string;
};

/** Reduce a workflow result to a pass/fail headline for the panel. */
export const summarizeWorkflow = (
  result: Partial<WorkflowResult> | null | undefined
): WorkflowSummary => {
  if (!result || result.error) {
    return { ok: false, passed: 0, total: 0, label: result?.error ? "Error" : "No result" };
  }
  const checks = Array.isArray(result.checks) ? result.checks : [];
  const passed = checks.filter((c) => c.ok).length;
  const total = checks.length;
  const ok = Boolean(result.ok);
  const label = ok ? `Passed ${passed}/${total}` : total ? `Failed ${passed}/${total}` : "Not supported";
  return { ok, passed, total, label };
};
