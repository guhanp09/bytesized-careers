import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { NotificationList } from "../../components/marketplace/NotificationList";
import { PageHeader } from "../../components/ui";
import { authOptions } from "../../lib/auth";
import { listNotifications } from "../../lib/backendClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NotificationsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !session.backendAccessToken) {
    redirect(`/auth?mode=login&next=${encodeURIComponent("/notifications")}`);
  }

  const payload = await listNotifications(session.backendAccessToken).catch(() => ({ items: [], unread_count: 0 }));

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white sm:px-6">
      <section className="mx-auto max-w-4xl space-y-7">
        <PageHeader
          title="Notifications"
          description="Applications, invites, checkout confirmations, and profile reminders."
        />
        <NotificationList
          accessToken={session.backendAccessToken}
          initialItems={payload.items}
          initialUnread={payload.unread_count}
        />
      </section>
    </main>
  );
}
