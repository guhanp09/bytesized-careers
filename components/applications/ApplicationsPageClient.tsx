"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ApplicationsWorkspace from "../you/ApplicationsWorkspace";
import { purgeLegacyStorageKey, userStorageKey } from "../../lib/userScopedStorage";
import { resolveScenario, type ScenarioName } from "../../lib/seed/scenarioNames";
import { toOwnerInteractions } from "../../lib/seed/scenarioManifest";
import type { OwnerInteraction } from "../../lib/ownerInteractions";

type ApplicationsViewMode = "talent" | "hiring";
type WorkspaceView = "inbox" | "pipeline";
type PipelineDirection = "received" | "sent";

const MODES: Array<{ key: ApplicationsViewMode; label: string }> = [
  { key: "talent", label: "Talent" },
  { key: "hiring", label: "Recruiter" },
];

/**
 * The user's last workspace shape, restored on return so /applications reopens
 * the way they left it (Pipeline stays Pipeline). URL params always win over
 * the saved state so deep links and notification links stay authoritative.
 *
 * The key is scoped per backend user: restoring another account's saved mode
 * (e.g. after a QA persona switch) would steer this user into the wrong side of
 * the inbox and contradict their notifications.
 */
const STORAGE_KEY = "cj.applications.workspace";

type SavedWorkspaceState = {
  view?: WorkspaceView;
  mode?: ApplicationsViewMode;
  direction?: PipelineDirection;
};

function readSavedState(storageKey: string): SavedWorkspaceState {
  try {
    purgeLegacyStorageKey(STORAGE_KEY);
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      view: parsed.view === "pipeline" || parsed.view === "inbox" ? parsed.view : undefined,
      mode: parsed.mode === "talent" || parsed.mode === "hiring" ? parsed.mode : undefined,
      direction:
        parsed.direction === "received" || parsed.direction === "sent" ? parsed.direction : undefined,
    };
  } catch {
    return {};
  }
}

function parseMode(value: string | null): ApplicationsViewMode | null {
  if (value === "recruiter" || value === "hiring") return "hiring";
  if (value === "talent") return "talent";
  return null;
}

/**
 * Dedicated full-page Applications workspace. Owns the workspace shape (mode,
 * Inbox/Pipeline view, pipeline direction + focused stage) so it survives the
 * per-mode remount of the workspace, persists across visits, and is
 * deep-linkable, e.g. /applications?view=pipeline&mode=recruiter&stage=shortlisted.
 *
 * The legacy contract is preserved: ?view=talent|recruiter|hiring (used by
 * notification links) still selects the mode, and ?thread= still opens that
 * conversation in the Inbox.
 */
export default function ApplicationsPageClient({
  backendAccessToken,
  backendUserId,
  allowDemo = false,
}: {
  backendAccessToken?: string;
  /** Backend user id of the signed-in account; scopes persisted client state. */
  backendUserId?: string;
  /** Server-computed: true outside production, where browsing mock data is allowed. */
  allowDemo?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Deep-link target: "Open conversation" after applying / sending a request
  // lands here with ?thread=<recordId>, so the inbox opens on that thread.
  const threadParam = searchParams.get("thread");

  // ?view= historically carried the mode; it now also accepts the layout.
  const viewParam = searchParams.get("view");
  const viewFromUrl: WorkspaceView | null =
    viewParam === "pipeline" || viewParam === "inbox" ? viewParam : null;
  const modeFromUrl = parseMode(searchParams.get("mode")) ?? parseMode(viewParam);
  const directionParam = searchParams.get("direction");
  const directionFromUrl: PipelineDirection | null =
    directionParam === "received" || directionParam === "sent" ? directionParam : null;

  const [mode, setMode] = useState<ApplicationsViewMode>(modeFromUrl ?? "talent");
  // A thread deep-link is a conversation: it always opens in the Inbox.
  const [view, setView] = useState<WorkspaceView>(threadParam ? "inbox" : viewFromUrl ?? "inbox");
  const [direction, setDirection] = useState<PipelineDirection>(directionFromUrl ?? "received");
  const [stage, setStage] = useState<string | null>(searchParams.get("stage"));
  // Saved-state restore happens once on mount; URL writes only after that.
  const [restored, setRestored] = useState(false);

  const urlSpecified = useRef({
    view: Boolean(viewFromUrl) || Boolean(threadParam),
    mode: Boolean(modeFromUrl),
    direction: Boolean(directionFromUrl),
  });

  const workspaceStorageKey = userStorageKey(STORAGE_KEY, backendUserId);

  useEffect(() => {
    const saved = readSavedState(workspaceStorageKey);
    if (!urlSpecified.current.view && saved.view) setView(saved.view);
    if (!urlSpecified.current.mode && saved.mode) setMode(saved.mode);
    if (!urlSpecified.current.direction && saved.direction) setDirection(saved.direction);
    setRestored(true);
    // Restore runs exactly once, against the mount-time URL snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow later in-app navigations (e.g. clicking a bell notification while
  // already on /applications): the page does not remount, so URL params must
  // keep steering the workspace after mount. Setting an unchanged value is a
  // no-op, so this never fights the user's own toggles.
  useEffect(() => {
    if (threadParam) setView("inbox");
    else if (viewFromUrl) setView(viewFromUrl);
    if (modeFromUrl) setMode(modeFromUrl);
    if (directionFromUrl) setDirection(directionFromUrl);
  }, [threadParam, viewFromUrl, modeFromUrl, directionFromUrl]);

  // Persist the workspace shape and keep the URL shareable. history.replaceState
  // avoids a server roundtrip on every toggle (Next keeps useSearchParams in sync).
  useEffect(() => {
    if (!restored) return;
    try {
      window.localStorage.setItem(workspaceStorageKey, JSON.stringify({ view, mode, direction }));
    } catch {
      // Storage can be unavailable (private mode); the workspace still works.
    }
    const params = new URLSearchParams(window.location.search);
    params.set("view", view);
    params.set("mode", mode === "hiring" ? "recruiter" : "talent");
    if (view === "pipeline") {
      params.set("direction", direction);
      if (stage) params.set("stage", stage);
      else params.delete("stage");
    } else {
      params.delete("direction");
      params.delete("stage");
    }
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
  }, [restored, view, mode, direction, stage, pathname, workspaceStorageKey]);

  // Opt-in demo data so the UI can be browsed without a backend. Only honoured
  // outside production, so mock data can never surface to real users.
  const demoRequested = searchParams.get("demo") === "1" || searchParams.get("mock") === "1";
  const [demoMode, setDemoMode] = useState(allowDemo && demoRequested);

  /*
    Scenario selection.

    `?seed=` names one of the six generated manifests. In Mock mode it selects
    the dataset immediately, because nothing is persisted and switching costs
    nothing. In Backend mode it deliberately does *not* restore anything: a URL
    that silently rewrote the database would make every shared link a
    destructive action. There, the parameter only preselects which scenario the
    existing confirmation-gated restore should be pointed at.

    An unknown name is surfaced as an error rather than falling back to
    `default`, so nobody spends an afternoon testing a dataset they did not ask
    for.
  */
  const seedParam = searchParams.get("seed");
  const resolvedScenario = resolveScenario({ query: seedParam });
  const [scenarioInteractions, setScenarioInteractions] = useState<OwnerInteraction[] | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(resolvedScenario.error);

  useEffect(() => {
    setScenarioError(resolvedScenario.error);
    // Only Mock mode reads a manifest. With a backend token the workspace shows
    // real data, and quietly replacing it with seed rows would be worse than
    // ignoring the parameter.
    /*
      Only when a scenario is explicitly named.

      Without this, `?demo=1` alone would swap the generated manifest in for the
      existing Mock fixture — which is exactly what happened, and it broke every
      test written against that fixture. Retiring the hand-written fixture is a
      deliberate step that comes after parity is proven, not a side effect of
      adding a loader.
    */
    if (!seedParam || !allowDemo || !demoMode || resolvedScenario.error) {
      setScenarioInteractions(null);
      return;
    }
    let cancelled = false;
    const scenario: ScenarioName = resolvedScenario.scenario;
    (async () => {
      try {
        const response = await fetch(`/api/dev/scenario/${scenario}`, { cache: "no-store" });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `Scenario "${scenario}" could not be loaded.`);
        }
        const manifest = await response.json();
        if (cancelled) return;
        setScenarioInteractions([
          ...toOwnerInteractions(manifest, { mode: "recruiter", anchorMode: "now" }),
          ...toOwnerInteractions(manifest, { mode: "talent", anchorMode: "now" }),
        ]);
      } catch (error) {
        if (!cancelled) {
          setScenarioInteractions(null);
          setScenarioError(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seedParam, allowDemo, demoMode, resolvedScenario.scenario, resolvedScenario.error]);

  const toggleDemo = () => {
    const next = !demoMode;
    setDemoMode(next);
    // Persist in the URL so it survives refresh and is shareable while testing.
    const params = new URLSearchParams(window.location.search);
    if (next) {
      params.set("demo", "1");
    } else {
      params.delete("demo");
      params.delete("mock");
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <div className="h-full min-h-0 w-full">
      <h1 className="sr-only">Applications</h1>
      {scenarioError ? (
        <p
          data-testid="scenario-error"
          role="alert"
          className="mx-3 mt-3 rounded-xl border border-amber-200/30 bg-amber-200/10 px-4 py-2.5 text-xs text-amber-100"
        >
          {scenarioError}
        </p>
      ) : null}
      <ApplicationsWorkspace
        /*
          The scenario is part of the key, and so is whether its data has
          arrived. The workspace seeds its item state once on mount, so a
          manifest that resolves a moment later would otherwise never be shown —
          every scenario would quietly render the same rows.
        */
        key={`applications-${mode}-${demoMode ? "demo" : "live"}-${resolvedScenario.scenario}-${
          scenarioInteractions ? "seeded" : "pending"
        }`}
        mode={mode}
        modeOptions={MODES}
        onModeChange={(next) => {
          setMode(next);
          // Each mode manages a different status vocabulary; drop the stage focus.
          setStage(null);
        }}
        controlsReady={restored}
        allowDemo={allowDemo}
        demoMode={demoMode}
        onToggleDemo={toggleDemo}
        backendAccessToken={backendAccessToken}
        backendUserId={backendUserId}
        forceMock={demoMode}
        interactions={scenarioInteractions ?? undefined}
        initialSelectedId={threadParam}
        view={view}
        onViewChange={setView}
        pipelineDirection={direction}
        onPipelineDirectionChange={(next) => {
          setDirection(next);
          // Stage vocabularies differ per board; a stale focus would hide cards.
          setStage(null);
        }}
        pipelineStage={stage}
        onPipelineStageChange={setStage}
      />
    </div>
  );
}
