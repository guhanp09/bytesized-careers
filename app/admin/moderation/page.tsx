import { noindexPage } from "../../../lib/seo/noindex";

// Authenticated surface: it carries its own noindex rather than relying on a
// robots.txt Disallow, which would stop the crawler reading this directive.
export const metadata = noindexPage("Moderation");

import { redirect } from "next/navigation";

/**
 * The original single-page moderation queue grew into the full admin panel;
 * its work now lives in the Reports section.
 */
export default function AdminModerationRedirect() {
  redirect("/admin/reports");
}
