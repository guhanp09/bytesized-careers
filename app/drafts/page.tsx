import { noindexPage } from "../../lib/seo/noindex";

// Authenticated surface: it carries its own noindex rather than relying on a
// robots.txt Disallow, which would stop the crawler reading this directive.
export const metadata = noindexPage("Drafts");

import { getServerSession } from "next-auth";
import { PageHeader, StateCard } from "../../components/ui";
import { authOptions } from "../../lib/auth";
import { isLocalMocksEnabled, isProductionRuntime } from "../../lib/backendClient";
import DraftsPageClient from "../../components/drafts/DraftsPageClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DraftsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return (
      <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-10 text-white sm:px-6">
        <section className="mx-auto max-w-6xl space-y-6">
          <PageHeader
            title="Drafts"
            description="Resume unfinished job and talent listings — saved to your account and synced across devices."
          />
          <StateCard
            icon="file"
            title="Sign in to open your drafts."
            description="Unfinished job and talent listings you save stay here, so you can resume them anytime without starting over."
            actionLabel="Sign in"
            actionHref="/auth?mode=login&next=/drafts"
          />
        </section>
      </main>
    );
  }

  const params = await searchParams;
  const first = (value?: string | string[]) => Array.isArray(value) ? value[0] : value;
  const allowDemo = !isProductionRuntime();
  const demoRequested = first(params.demo) === "1" || first(params.mock) === "1";
  const demoDrafts = allowDemo && (demoRequested || isLocalMocksEnabled())
    ? (await import("../../lib/mockOwnerDrafts")).MOCK_OWNER_DRAFTS
    : undefined;

  return (
    // Inbox-style canvas: on desktop the split workspace fills the viewport below the
    // fixed 56px header and scrolls internally (no vertical gutter, no enclosing card);
    // on mobile it falls back to natural document flow with padding.
    <main className="flex min-h-[calc(100dvh-56px)] flex-col bg-[#0b0b0f] text-white lg:h-[calc(100dvh-56px)] lg:overflow-hidden">
      <section className="mx-auto flex w-full max-w-[1760px] flex-col px-3 py-5 sm:px-5 sm:py-7 xl:px-6 2xl:px-8 lg:min-h-0 lg:flex-1 lg:py-0">
        {/* allowDemo is computed server-side: the client can't read APP_ENV/VERCEL_ENV,
            so the sample-data preview is gated by the reliable server value. */}
        <DraftsPageClient
          backendAccessToken={session.backendAccessToken}
          allowDemo={allowDemo}
          demoDrafts={demoDrafts}
        />
      </section>
    </main>
  );
}
