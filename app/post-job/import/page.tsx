import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isJobImportAllowed } from "../../../lib/importJob/flag";
import ImportJobClientBoundary from "../../../components/import-job/ImportJobClientBoundary";

export const metadata: Metadata = {
  title: "Import a hiring post — CreatorJobs",
  description: "Paste a job announcement you've already written and CreatorJobs will prepare the draft.",
};

export default function ImportJobPage() {
  // Server-only flag gate (plan D9): when disabled, the route is absent — not hidden.
  if (!isJobImportAllowed()) notFound();
  return <ImportJobClientBoundary />;
}
