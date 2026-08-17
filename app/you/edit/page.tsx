import { noindexPage } from "../../../lib/seo/noindex";

// Authenticated surface: it carries its own noindex rather than relying on a
// robots.txt Disallow, which would stop the crawler reading this directive.
export const metadata = noindexPage("Edit your profile");

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Profile editing now happens inline on /you (the dedicated editor page was
// retired because a separate page felt disconnected from the profile). Preserve
// any existing links/bookmarks to /you/edit by redirecting to the profile.
export default function EditYouRedirect() {
  redirect("/you");
}
