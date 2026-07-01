import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Profile editing now happens inline on /you (the dedicated editor page was
// retired because a separate page felt disconnected from the profile). Preserve
// any existing links/bookmarks to /you/edit by redirecting to the profile.
export default function EditYouRedirect() {
  redirect("/you");
}
