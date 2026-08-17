import { noindexPage } from "../../../lib/seo/noindex";

// Authenticated surface: it carries its own noindex rather than relying on a
// robots.txt Disallow, which would stop the crawler reading this directive.
export const metadata = noindexPage("Getting started");

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../../lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const safeNextPath = (value?: string) => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/you";
  return value;
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const session = await getServerSession(authOptions);
  const { next } = await searchParams;
  const nextValue = Array.isArray(next) ? next[0] : next;
  const nextPath = safeNextPath(nextValue);

  if (!session?.user || !session.backendAccessToken) {
    redirect(`/auth?mode=login&next=${encodeURIComponent(nextPath)}`);
  }

  redirect(nextPath);
}
