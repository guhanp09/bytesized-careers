"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ApplicationsWorkspace from "../you/ApplicationsWorkspace";

type ApplicationsViewMode = "talent" | "hiring";

const MODES: Array<{ key: ApplicationsViewMode; label: string }> = [
  { key: "talent", label: "Talent" },
  { key: "hiring", label: "Recruiter" },
];

/**
 * Dedicated full-page Applications workspace. Holds the Talent/Recruiter context
 * toggle and a (non-production) sample-data toggle, and hands the master-detail
 * inbox the full canvas.
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

  const viewParam = searchParams.get("view");
  const [mode, setMode] = useState<ApplicationsViewMode>(
    viewParam === "recruiter" || viewParam === "hiring" ? "hiring" : "talent"
  );

  // Opt-in demo data so the UI can be browsed without a backend. Only honoured
  // outside production, so mock data can never surface to real users.
  const demoRequested = searchParams.get("demo") === "1" || searchParams.get("mock") === "1";
  const [demoMode, setDemoMode] = useState(allowDemo && demoRequested);

  const toggleDemo = () => {
    const next = !demoMode;
    setDemoMode(next);
    // Persist in the URL so it survives refresh and is shareable while testing.
    const params = new URLSearchParams(searchParams.toString());
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
        onModeChange={setMode}
        allowDemo={allowDemo}
        demoMode={demoMode}
        onToggleDemo={toggleDemo}
        backendAccessToken={backendAccessToken}
        forceMock={demoMode}
      />
    </div>
  );
}
