"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  evaluateDevDataSwitchAllowed,
  type MarketplaceDataSource,
  type MarketplaceDataSourceState,
} from "../../lib/devDataSource";

type Status = MarketplaceDataSourceState & {
  error?: string;
};

const LABELS: Record<MarketplaceDataSource, string> = {
  backend: "Backend",
  mock: "Mock",
};

const CLIENT_SWITCH_ENABLED = evaluateDevDataSwitchAllowed({
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  NEXT_PUBLIC_ENABLE_DEV_DATA_SWITCH: process.env.NEXT_PUBLIC_ENABLE_DEV_DATA_SWITCH,
  NODE_ENV: process.env.NODE_ENV,
});

export default function DevDataSourceSwitch() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [busySource, setBusySource] = useState<MarketplaceDataSource | null>(null);

  useEffect(() => {
    if (!CLIENT_SWITCH_ENABLED) return;

    let mounted = true;
    void fetch("/api/dev/data-source", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as Status;
      })
      .then((payload) => {
        if (!mounted || !payload?.enabled) return;
        setStatus(payload);
      })
      .catch(() => {
        if (!mounted) return;
        setStatus(null);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const selectSource = useCallback(
    async (source: MarketplaceDataSource) => {
      if (busySource || source === status?.source) return;
      setBusySource(source);
      try {
        const response = await fetch("/api/dev/data-source", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source }),
        });
        if (!response.ok) return;
        const payload = (await response.json()) as Status;
        setStatus(payload);
        router.refresh();
      } finally {
        setBusySource(null);
      }
    },
    [busySource, router, status?.source]
  );

  if (!status?.enabled) return null;

  return (
    <div
      data-testid="dev-data-source-switch"
      className="hidden items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.045] p-0.5 text-[11px] font-semibold text-white/62 shadow-[0_10px_30px_-24px_rgba(0,0,0,0.9)] md:inline-flex"
      aria-label="Development marketplace data source"
      title="Development only marketplace data source"
    >
      <span className="px-2 text-[10px] uppercase tracking-[0.16em] text-subtle">DEV</span>
      {(["backend", "mock"] as const).map((source) => {
        const active = status.source === source;
        const busy = busySource === source;
        return (
          <button
            key={source}
            type="button"
            className={[
              "h-7 cursor-pointer rounded-full px-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
              active ? "bg-white text-black" : "text-white/54 hover:bg-white/[0.07] hover:text-white",
              busy ? "opacity-70" : "",
            ].join(" ")}
            aria-pressed={active}
            disabled={Boolean(busySource)}
            onClick={() => void selectSource(source)}
          >
            {busy ? "Switching..." : LABELS[source]}
          </button>
        );
      })}
    </div>
  );
}
