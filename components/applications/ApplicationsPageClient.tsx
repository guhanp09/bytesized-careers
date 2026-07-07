"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ApplicationsWorkspace from "../you/ApplicationsWorkspace";

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
 */
const STORAGE_KEY = "cj.applications.workspace";

type SavedWorkspaceState = {
  view?: WorkspaceView;
  mode?: ApplicationsViewMode;
  direction?: PipelineDirection;
};

function readSavedState(): SavedWorkspaceState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
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
  allowDemo = false,
}: {
  backendAccessToken?: string;
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

  useEffect(() => {
    const saved = readSavedState();
    if (!urlSpecified.current.view && saved.view) setView(saved.view);
    if (!urlSpecified.current.mode && saved.mode) setMode(saved.mode);
    if (!urlSpecified.current.direction && saved.direction) setDirection(saved.direction);
    setRestored(true);
    // Restore runs exactly once, against the mount-time URL snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the workspace shape and keep the URL shareable. history.replaceState
  // avoids a server roundtrip on every toggle (Next keeps useSearchParams in sync).
  useEffect(() => {
    if (!restored) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ view, mode, direction }));
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
  }, [restored, view, mode, direction, stage, pathname]);

  // Opt-in demo data so the UI can be browsed without a backend. Only honoured
  // outside production, so mock data can never surface to real users.
  const demoRequested = searchParams.get("demo") === "1" || searchParams.get("mock") === "1";
  const [demoMode, setDemoMode] = useState(allowDemo && demoRequested);

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
      <ApplicationsWorkspace
        key={`applications-${mode}-${demoMode ? "demo" : "live"}`}
        mode={mode}
        modeOptions={MODES}
        onModeChange={(next) => {
          setMode(next);
          // Each mode manages a different status vocabulary; drop the stage focus.
          setStage(null);
        }}
        allowDemo={allowDemo}
        demoMode={demoMode}
        onToggleDemo={toggleDemo}
        backendAccessToken={backendAccessToken}
        forceMock={demoMode}
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
