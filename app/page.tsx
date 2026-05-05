import JobGridClient from "../components/JobGridClient";
import { isLocalMocksEnabled, listJobsWithMeta } from "../lib/backendClient";
import { listJobs as listJobsFromLocal } from "../lib/repositories/jobRepository";
import { Job } from "../lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ posted?: string | string[] }>;
}) {
  const { posted } = await searchParams;
  const postedValue = Array.isArray(posted) ? posted[0] : posted;
  const usingLocal = isLocalMocksEnabled();
  let jobs: Job[] = [];

  if (usingLocal) {
    jobs = await listJobsFromLocal();
  } else {
    const backendResponse = await listJobsWithMeta({ limit: 100, offset: 0 });
    jobs = backendResponse.items ?? [];
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[jobs][backend] url=${backendResponse.backendUrl} total=${backendResponse.total} items=${backendResponse.items.length}`
      );
    }
  }

  const notice =
    postedValue === "1"
      ? "Job posted. It should appear at the top of the feed. Refresh to verify it persists."
      : null;

  return <JobGridClient jobs={jobs} notice={notice} />;
}
