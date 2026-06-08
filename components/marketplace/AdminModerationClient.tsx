"use client";

import { useState } from "react";
import { updateAdminReport, type BackendReport } from "../../lib/backendClient";

export function AdminModerationClient({
  accessToken,
  initialReports,
}: {
  accessToken: string;
  initialReports: BackendReport[];
}) {
  const [reports, setReports] = useState(initialReports);
  const [busyId, setBusyId] = useState<string | null>(null);

  const act = async (reportId: string, action: string) => {
    setBusyId(reportId);
    try {
      const updated = await updateAdminReport(accessToken, reportId, {
        status: action === "dismiss" ? "dismissed" : "action_taken",
        action,
      });
      setReports((current) => current.map((item) => (item.id === reportId ? updated : item)));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      {reports.length ? (
        reports.map((report) => (
          <article key={report.id} className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white/90">
                  {report.target_type.replace("_", " ")} · {report.category}
                </p>
                <p className="mt-1 text-xs text-white/42">Target {report.target_id}</p>
                {report.note ? <p className="mt-3 max-w-3xl text-sm leading-6 text-white/62">{report.note}</p> : null}
                <p className="mt-3 text-xs uppercase tracking-[0.14em] text-white/38">
                  {report.status}{report.action ? ` · ${report.action.replace("_", " ")}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {["dismiss", "pause_listing", "hide_listing"].map((action) => (
                  <button
                    key={action}
                    type="button"
                    disabled={busyId === report.id}
                    className="cursor-pointer rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                    onClick={() => void act(report.id, action)}
                  >
                    {busyId === report.id ? "Working..." : action.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>
          </article>
        ))
      ) : (
        <div className="rounded-[28px] border border-white/10 bg-white/[0.035] px-6 py-12 text-center text-sm text-white/55">
          No open reports.
        </div>
      )}
    </div>
  );
}

