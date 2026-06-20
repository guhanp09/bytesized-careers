import JobGridClient from "../../components/JobGridClient";
import { canUseLocalMockFallback, isLocalMocksEnabled, listJobsWithMeta } from "../../lib/backendClient";
import { listJobs as listJobsFromLocal } from "../../lib/repositories/jobRepository";
import { Job } from "../../lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value) || "";

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = first(params.q);
  const platform = first(params.platform);
  const location = first(params.location);
  const startTimeframe = first(params.start_timeframe);
  const posted = first(params.posted);

  let jobs: Job[] = [];
  let notice: string | null = null;
  const usingLocal = isLocalMocksEnabled();
  const canUseMocks = canUseLocalMockFallback();
  if (usingLocal) {
    jobs = await listJobsFromLocal();
  } else {
    try {
      const response = await listJobsWithMeta({
        q,
        platform,
        location,
        start_timeframe: startTimeframe,
        status: "published",
        limit: 100,
        offset: 0,
      });
      jobs = response.items;
    } catch {
      if (canUseMocks) {
        jobs = await listJobsFromLocal();
        notice =
          "Backend not reachable — showing local sample listings for development, not the live feed. Start it with `npm run dev:all` (or `npm run dev:backend`), then refresh.";
      } else {
        jobs = [];
        notice = "Jobs could not be loaded right now. Please try again shortly.";
      }
    }
  }

  if (posted === "1") {
    notice = "Job posted. It should appear at the top of the feed. Refresh to verify it persists.";
  }

  return <JobGridClient jobs={jobs} notice={notice} />;
}
