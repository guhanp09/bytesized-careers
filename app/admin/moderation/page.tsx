import { redirect } from "next/navigation";

/**
 * The original single-page moderation queue grew into the full admin panel;
 * its work now lives in the Reports section.
 */
export default function AdminModerationRedirect() {
  redirect("/admin/reports");
}
