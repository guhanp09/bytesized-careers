import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isJobImportAllowed } from "../../../lib/importJob/flag";
import ImportJobClientBoundary from "../../../components/import-job/ImportJobClientBoundary";

export const metadata: Metadata = {
  title: "Import job details — CreatorJobs",
  description:
    "Start from existing text or a public job-listing URL, then continue in a prefilled CreatorJobs Post Job draft.",
};

export default function ImportJobPage() {
  // Server-only flag gate (plan D9): when disabled, the route is absent — not hidden.
  if (!isJobImportAllowed()) notFound();
  return <ImportJobClientBoundary />;
}
