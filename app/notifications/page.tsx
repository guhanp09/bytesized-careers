import { noindexPage } from "../../lib/seo/noindex";

// Authenticated surface: it carries its own noindex rather than relying on a
// robots.txt Disallow, which would stop the crawler reading this directive.
export const metadata = noindexPage("Notifications");

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { NotificationList } from "../../components/marketplace/NotificationList";
import { PageHeader, StateCard } from "../../components/ui";
import { authOptions } from "../../lib/auth";
import {
  classifyBackendLoadResult,
  hasBackendSessionAuthError,
  type BackendLoadState,
} from "../../lib/backendLoadState";
import { listNotifications } from "../../lib/backendClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NotificationsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect(`/auth?mode=login&next=${encodeURIComponent("/notifications")}`);
  }

  const token = session.backendAccessToken;
  const loadState: BackendLoadState<Awaited<ReturnType<typeof listNotifications>>> =
    !token || hasBackendSessionAuthError(session)
      ? { kind: "auth" }
      : classifyBackendLoadResult(
          (await Promise.allSettled([listNotifications(token)]))[0]
        );

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white sm:px-6">
      <section className="mx-auto max-w-4xl space-y-7">
        <PageHeader
          title="Notifications"
          description="Applications, invites, listing updates, and profile reminders."
        />
        {loadState.kind === "auth" ? (
          <div data-testid="notifications-auth-expired">
            <StateCard
              icon="bell"
              title="Your session has expired."
              description="Sign in again to see your notifications."
              actionLabel="Sign in again"
              actionHref="/auth?mode=login&next=/notifications"
            />
          </div>
        ) : loadState.kind === "error" ? (
          <div data-testid="notifications-load-error">
            <StateCard
              icon="alert"
              title="Couldn’t load notifications."
              description="The backend is unreachable right now. Your notifications are safe — try again in a moment."
              actionLabel="Retry"
              actionHref="/notifications"
            />
          </div>
        ) : (
          <NotificationList
            accessToken={token as string}
            initialItems={loadState.data.items}
            initialUnread={loadState.data.unread_count}
          />
        )}
      </section>
    </main>
  );
}
