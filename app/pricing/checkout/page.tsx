import { noindexPage } from "../../../lib/seo/noindex";

// Authenticated surface: it carries its own noindex rather than relying on a
// robots.txt Disallow, which would stop the crawler reading this directive.
export const metadata = noindexPage("Checkout");

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { CheckoutPanel } from "../../../components/marketplace/CheckoutPanel";
import { PageHeader } from "../../../components/ui";
import { authOptions } from "../../../lib/auth";
import type { BackendEntitlement } from "../../../lib/backendClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value) || "";
const validKinds: BackendEntitlement["kind"][] = [
  "job_post",
  "talent_listing",
  "featured_job",
  "featured_talent_listing",
];

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !session.backendAccessToken) {
    redirect(`/auth?mode=login&next=${encodeURIComponent("/pricing/checkout")}`);
  }
  const params = await searchParams;
  const kindParam = first(params.kind);
  const kind = validKinds.includes(kindParam as BackendEntitlement["kind"])
    ? (kindParam as BackendEntitlement["kind"])
    : "job_post";

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white sm:px-6">
      <section className="mx-auto max-w-2xl space-y-6">
        <PageHeader
          title="Checkout"
          description="Free during beta. Confirm the entitlement so your listing can publish with the same flow that paid actions will use later."
        />
        <CheckoutPanel
          accessToken={session.backendAccessToken}
          kind={kind}
          targetType={first(params.target_type) || null}
          targetId={first(params.target_id) || null}
          nextUrl={first(params.next) || undefined}
        />
      </section>
    </main>
  );
}
