import { noindexPage } from "../../lib/seo/noindex";

// Authenticated surface: it carries its own noindex rather than relying on a
// robots.txt Disallow, which would stop the crawler reading this directive.
export const metadata = noindexPage("Activity");

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value) || "";

const activityRedirectFor = (tab: string) => {
  switch (tab) {
    case "drafts":
      return "/drafts";
    case "updates":
      return "/notifications";
    case "applicants":
      return "/applications?view=hiring";
    case "interests":
    case "leads":
      return "/applications?view=talent";
    case "applications":
    default:
      return "/applications";
  }
};

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  redirect(activityRedirectFor(first(params.tab)));
}
