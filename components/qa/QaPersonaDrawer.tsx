"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import { Icon } from "../Icons";
import type { QaPersona, QaScenario, QaStatus } from "../../lib/qaPersonas";

type Tab = "personas" | "scenarios" | "guide" | "system";
type PersonaPayload = { personas: QaPersona[] };
type ScenarioPayload = { scenarios: QaScenario[] };

const GUIDE = [
  {
    title: "Application handoff",
    copy: "Priya applies, Finance Simplified reviews the application, then Priya sees the update.",
    route: "/jobs",
  },
  {
    title: "Hiring request",
    copy: "Finance Simplified contacts talent, then switch to the Talent side to respond and message.",
    route: "/talent",
  },
  {
    title: "Engagement and reviews",
    copy: "Use the seeded lifecycle rows to test start, completion, blind feedback, and publication.",
    route: "/applications",
  },
  {
    title: "Moderation",
    copy: "Report deterministic content, switch to QA Moderator, and verify reversible admin actions.",
    route: "/admin/reports",
  },
];

const tabIcon: Record<Tab, Parameters<typeof Icon>[0]["name"]> = {
  personas: "users",
  scenarios: "layers",
  guide: "notebook-text",
  system: "settings",
};

export default function QaPersonaDrawer() {
  const { data: session, status: sessionStatus, update } = useSession();
  const [authorized, setAuthorized] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("personas");
  const [personas, setPersonas] = useState<QaPersona[]>([]);
  const [scenarios, setScenarios] = useState<QaScenario[]>([]);
  const [qaStatus, setQaStatus] = useState<QaStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmPersona, setConfirmPersona] = useState<QaPersona | null>(null);
  const [restoreScenario, setRestoreScenario] = useState<QaScenario | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const activePersona = session?.qaPersona;

  const load = useCallback(async () => {
    if (sessionStatus !== "authenticated") {
      setAuthorized(false);
      return;
    }
    try {
      const [personaResponse, scenarioResponse, statusResponse] = await Promise.all([
        fetch("/api/qa/personas", { cache: "no-store" }),
        fetch("/api/qa/scenarios", { cache: "no-store" }),
        fetch("/api/qa/status", { cache: "no-store" }),
      ]);
      if (!personaResponse.ok || !scenarioResponse.ok || !statusResponse.ok) {
        setAuthorized(false);
        return;
      }
      const personaPayload = (await personaResponse.json()) as PersonaPayload;
      const scenarioPayload = (await scenarioResponse.json()) as ScenarioPayload;
      const statusPayload = (await statusResponse.json()) as QaStatus;
      setPersonas(personaPayload.personas || []);
      setScenarios(scenarioPayload.scenarios || []);
      setQaStatus(statusPayload);
      setAuthorized(true);
    } catch {
      setAuthorized(false);
    }
  }, [sessionStatus]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load, activePersona?.key]);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [message]);

  const closeDrawer = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => closeRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (restoreScenario) {
        setRestoreScenario(null);
        setConfirmation("");
        return;
      }
      if (confirmPersona) {
        setConfirmPersona(null);
        return;
      }
      closeDrawer();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeDrawer, confirmPersona, open, restoreScenario]);

  const switchPersona = async (persona: QaPersona) => {
    setBusy(`persona:${persona.key}`);
    setMessage(null);
    try {
      const next = await update({ qaPersonaAction: "switch", qaPersonaKey: persona.key });
      if (next?.qaPersona?.key !== persona.key) {
        setMessage("Could not start that QA persona. Check the backend status and fixture health.");
        setBusy(null);
        return;
      }
      window.location.reload();
    } catch {
      setMessage("Could not switch personas. No application data was changed.");
      setBusy(null);
    }
  };

  const requestPersona = (persona: QaPersona) => {
    if (persona.accountType === "ADMIN") {
      setConfirmPersona(persona);
      return;
    }
    void switchPersona(persona);
  };

  const exitPersona = async () => {
    setBusy("exit");
    try {
      await update({ qaPersonaAction: "exit" });
      window.location.reload();
    } catch {
      setMessage("Could not return to the controller session. Refresh and try again.");
      setBusy(null);
    }
  };

  const restore = async () => {
    if (!restoreScenario) return;
    setBusy(`restore:${restoreScenario.key}`);
    try {
      const response = await fetch(`/api/qa/scenarios/${restoreScenario.key}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      const payload = (await response.json()) as { detail?: string; error?: string };
      if (!response.ok) {
        setMessage(payload.detail || payload.error || "Scenario restore failed.");
        setBusy(null);
        return;
      }
      setMessage(`${restoreScenario.title} restored.`);
      setRestoreScenario(null);
      setConfirmation("");
      setBusy(null);
      await load();
    } catch {
      setMessage("Scenario restore could not reach the local QA backend.");
      setBusy(null);
    }
  };

  if (!authorized) return null;

  if (!open) {
    return (
      <button
        ref={triggerRef}
        type="button"
        data-testid="qa-persona-open"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-24 z-[120] inline-flex h-10 max-w-[calc(100vw-7rem)] items-center gap-2 rounded-full border border-amber-300/30 bg-[#16130d]/95 px-3 text-xs font-semibold text-amber-100 shadow-[0_14px_36px_-18px_rgba(0,0,0,0.95)] backdrop-blur-xl transition hover:border-amber-200/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200/40 max-sm:left-3"
        aria-label="Open QA persona controls"
        aria-expanded="false"
        aria-controls="qa-persona-drawer"
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.5)]" />
        <span className="truncate">
          {activePersona ? `QA · ${activePersona.displayName}` : "QA personas"}
        </span>
      </button>
    );
  }

  return (
    <aside
      id="qa-persona-drawer"
      data-testid="qa-persona-drawer"
      aria-label="QA persona controls"
      role="dialog"
      className="fixed bottom-4 left-24 z-[120] flex max-h-[min(760px,calc(100dvh-2rem))] w-[390px] max-w-[calc(100vw-7rem)] flex-col overflow-hidden rounded-xl border border-amber-200/20 bg-[#0f0f12]/96 text-white shadow-[0_28px_80px_-28px_rgba(0,0,0,1)] backdrop-blur-2xl max-sm:left-3 max-sm:max-w-[calc(100vw-1.5rem)]"
    >
      <header className="border-b border-white/8 px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-300" />
              <h2 className="text-sm font-semibold">QA workspace</h2>
            </div>
            <p className="mt-1 text-xs text-white/45">
              {activePersona
                ? `Acting as ${activePersona.displayName}`
                : `Controller · ${qaStatus?.controllerEmail || "authorized"}`}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={closeDrawer}
            className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-white/55 transition hover:border-white/20 hover:text-white"
            aria-label="Close QA controls"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>

        {activePersona ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-300/15 bg-amber-300/[0.06] px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-amber-100">{activePersona.displayName}</p>
              <p className="text-[11px] text-amber-100/50">All product actions use this persona.</p>
            </div>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void exitPersona()}
              className="shrink-0 rounded-lg border border-amber-200/25 px-2.5 py-1.5 text-[11px] font-semibold text-amber-100 transition hover:bg-amber-200/10 disabled:opacity-45"
            >
              {busy === "exit" ? "Returning…" : "Return to Guhan"}
            </button>
          </div>
        ) : null}

        <nav className="mt-3 grid grid-cols-4 rounded-lg border border-white/8 bg-white/[0.025] p-1" aria-label="QA sections">
          {(["personas", "scenarios", "guide", "system"] as Tab[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-[11px] font-medium capitalize transition ${
                tab === item ? "bg-white text-black" : "text-white/48 hover:text-white/80"
              }`}
              aria-current={tab === item ? "page" : undefined}
            >
              <Icon name={tabIcon[item]} className="h-3.5 w-3.5" />
              <span className="max-sm:hidden">{item}</span>
            </button>
          ))}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        {tab === "personas" ? (
          <div className="space-y-2" data-testid="qa-persona-list">
            {personas.map((persona) => {
              const active = activePersona?.key === persona.key;
              return (
                <article
                  key={persona.key}
                  className={`rounded-lg border p-3 transition ${
                    active
                      ? "border-amber-300/30 bg-amber-300/[0.06]"
                      : "border-white/8 bg-white/[0.025] hover:border-white/15"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-white/90">{persona.displayName}</h3>
                        <span className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white/45">
                          {persona.modes.join(" · ")}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-4 text-white/48">{persona.description}</p>
                    </div>
                    <button
                      type="button"
                      data-testid={`qa-switch-${persona.key}`}
                      disabled={busy !== null || active}
                      onClick={() => requestPersona(persona)}
                      className="shrink-0 rounded-lg border border-white/12 px-2.5 py-1.5 text-[11px] font-semibold text-white/70 transition hover:border-amber-200/35 hover:text-amber-100 disabled:opacity-35"
                    >
                      {active ? "Active" : busy === `persona:${persona.key}` ? "Switching…" : "Use"}
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {persona.coverage.slice(0, 4).map((item) => (
                      <span key={item} className="rounded border border-white/8 bg-black/20 px-1.5 py-0.5 text-[10px] text-white/38">
                        {item}
                      </span>
                    ))}
                  </div>
                  <a href={persona.startRoute} className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-blue-300/75 hover:text-blue-200">
                    Open recommended page <Icon name="chevron-right" className="h-3 w-3" />
                  </a>
                </article>
              );
            })}
          </div>
        ) : null}

        {tab === "scenarios" ? (
          <div className="space-y-2" data-testid="qa-scenario-list">
            <p className="px-1 pb-1 text-[11px] leading-4 text-white/40">
              Restore only deterministic QA records. Ordinary staging accounts are never touched.
            </p>
            {scenarios.map((scenario) => (
              <article key={scenario.key} className="rounded-lg border border-white/8 bg-white/[0.025] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white/85">{scenario.title}</h3>
                    <p className="mt-1 text-[11px] leading-4 text-white/45">{scenario.purpose}</p>
                  </div>
                  <button
                    type="button"
                    data-testid={`qa-restore-${scenario.key}`}
                    disabled={busy !== null}
                    onClick={() => {
                      setRestoreScenario(scenario);
                      setConfirmation("");
                    }}
                    className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition disabled:opacity-40 ${
                      scenario.danger
                        ? "border-rose-300/25 text-rose-200 hover:bg-rose-300/10"
                        : "border-white/12 text-white/65 hover:border-white/25 hover:text-white"
                    }`}
                  >
                    Restore
                  </button>
                </div>
                <a href={scenario.startRoute} className="mt-2 inline-flex items-center gap-1 text-[10px] text-blue-300/70 hover:text-blue-200">
                  Open start page <Icon name="external-link" className="h-3 w-3" />
                </a>
              </article>
            ))}
          </div>
        ) : null}

        {tab === "guide" ? (
          <div className="space-y-2">
            {GUIDE.map((item, index) => (
              <article key={item.title} className="flex gap-3 rounded-lg border border-white/8 bg-white/[0.025] p-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/12 text-[10px] font-semibold text-white/50">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-white/85">{item.title}</h3>
                  <p className="mt-1 text-[11px] leading-4 text-white/45">{item.copy}</p>
                  <a href={item.route} className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-blue-300/70 hover:text-blue-200">
                    Begin workflow <Icon name="chevron-right" className="h-3 w-3" />
                  </a>
                </div>
              </article>
            ))}
            <p className="px-1 pt-1 text-[10px] leading-4 text-white/35">
              Full two-sided instructions are in QA_PERSONA_TESTING.md.
            </p>
          </div>
        ) : null}

        {tab === "system" ? (
          <dl className="overflow-hidden rounded-lg border border-white/8 bg-white/[0.025] text-xs">
            {[
              ["Environment", qaStatus?.environment || "—"],
              ["Controller", qaStatus?.controllerEmail || "—"],
              ["Personas", `${qaStatus?.personaCount || 0} / ${personas.length}`],
              ["Scenarios", String(qaStatus?.scenarioCount || scenarios.length)],
              ["Fixture health", qaStatus?.fixturesHealthy ? "Ready" : "Needs restore"],
              ["Backend mode", "Real persistence"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 border-b border-white/7 px-3 py-2.5 last:border-0">
                <dt className="text-white/42">{label}</dt>
                <dd className="max-w-[220px] truncate text-right font-medium text-white/75">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      {message ? (
        <div className="border-t border-white/8 px-4 py-2.5 text-[11px] text-amber-100/75" role="status">
          {message}
        </div>
      ) : null}

      {confirmPersona ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/70 p-5 backdrop-blur-sm">
          <div className="w-full rounded-xl border border-amber-200/25 bg-[#15130f] p-4 shadow-2xl" role="alertdialog" aria-modal="true" aria-label="Confirm QA Moderator">
            <Icon name="shield" className="h-6 w-6 text-amber-200" />
            <h3 className="mt-3 text-base font-semibold">Enter QA Moderator?</h3>
            <p className="mt-1.5 text-xs leading-5 text-white/50">
              This persona can hide listings, resolve reports, suspend QA users, and view the audit trail. Use only deterministic fixtures.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmPersona(null)} className="h-9 rounded-lg border border-white/12 px-3 text-xs text-white/65 hover:text-white">
                Cancel
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => {
                  const persona = confirmPersona;
                  setConfirmPersona(null);
                  void switchPersona(persona);
                }}
                className="h-9 rounded-lg bg-white px-3 text-xs font-semibold text-black"
              >
                Continue as moderator
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {restoreScenario ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/70 p-5 backdrop-blur-sm">
          <div className="w-full rounded-xl border border-white/15 bg-[#121216] p-4 shadow-2xl" role="dialog" aria-modal="true" aria-label={`Restore ${restoreScenario.title}`}>
            <Icon name="refresh" className="h-6 w-6 text-white/65" />
            <h3 className="mt-3 text-base font-semibold">Restore {restoreScenario.title}?</h3>
            <p className="mt-1.5 text-xs leading-5 text-white/45">Type the phrase below. Only deterministic QA records in this scenario are replaced.</p>
            <code className="mt-3 block rounded-lg border border-white/8 bg-black/25 px-3 py-2 text-xs text-amber-100/75">
              {restoreScenario.confirmation}
            </code>
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="mt-2 h-10 w-full rounded-lg border border-white/12 bg-white/[0.04] px-3 text-sm outline-none focus:border-amber-200/35"
              aria-label="Restore confirmation phrase"
              autoComplete="off"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setRestoreScenario(null)} className="h-9 rounded-lg border border-white/12 px-3 text-xs text-white/65 hover:text-white">
                Cancel
              </button>
              <button
                type="button"
                disabled={confirmation !== restoreScenario.confirmation || busy !== null}
                onClick={() => void restore()}
                className="h-9 rounded-lg bg-white px-3 text-xs font-semibold text-black disabled:opacity-35"
              >
                {busy === `restore:${restoreScenario.key}` ? "Restoring…" : "Restore scenario"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
