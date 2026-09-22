import { noindexPage } from "../../lib/seo/noindex";

// Authenticated surface: it carries its own noindex rather than relying on a
// robots.txt Disallow, which would stop the crawler reading this directive.
export const metadata = noindexPage("Settings");

import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { redirect } from "next/navigation";

import SettingsClient from "../../components/settings/SettingsClient";
import { PageHeader, StateCard } from "../../components/ui";
import { authOptions } from "../../lib/auth";
import {
  getMe,
  getMyProfile,
  listMyYouTubeChannels,
  listNotifications,
  type BackendMeResponse,
  type BackendNotificationListResponse,
  type BackendProfileResponse,
  type BackendYouTubeChannelsResponse,
} from "../../lib/backendClient";
import { hasBackendSessionAuthError } from "../../lib/backendLoadState";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const settledValue = <T,>(result: PromiseSettledResult<T>): T | null =>
  result.status === "fulfilled" ? result.value : null;

export default async function SettingsPage() {
  const session = (await getServerSession(authOptions)) as Session | null;
  if (!session?.user) {
    redirect(`/auth?mode=login&next=${encodeURIComponent("/settings")}`);
  }

  if (!session.backendAccessToken || hasBackendSessionAuthError(session)) {
    return (
      <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-10 text-white sm:px-6">
        <section className="mx-auto max-w-6xl space-y-6">
          <PageHeader
            title="Settings"
            description="Manage your account, profile visibility, work preferences, accounts and profile links, notifications, and security."
          />
          <StateCard
            icon="user"
            title="Your session has expired."
            description="Sign in again to manage settings for your CreatorJobs account."
            actionLabel="Sign in again"
            actionHref="/auth?mode=login&next=/settings"
          />
        </section>
      </main>
    );
  }

  const [meResult, profileResult, channelsResult, notificationsResult] = await Promise.allSettled([
    getMe(session.backendAccessToken),
    getMyProfile(session.backendAccessToken),
    listMyYouTubeChannels(session.backendAccessToken),
    listNotifications(session.backendAccessToken),
  ] as const);

  const me = settledValue<BackendMeResponse>(meResult);
  const profile = settledValue<BackendProfileResponse>(profileResult);
  const channels = settledValue<BackendYouTubeChannelsResponse>(channelsResult);
  const notifications = settledValue<BackendNotificationListResponse>(notificationsResult);

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-3 py-7 text-white sm:px-5 lg:py-9">
      <section className="mx-auto w-full max-w-[1440px] space-y-6">
        <PageHeader
          eyebrow="Account"
          title="Settings"
          description="Manage your account, profile visibility, work preferences, accounts and profile links, notifications, and security."
        />

        <SettingsClient
          backendAccessToken={session.backendAccessToken}
          sessionUser={{
            name: session.user.name,
            email: session.user.email,
            image: session.user.image,
            provider: session.user.provider,
            username: session.user.username,
            accountType: session.user.accountType,
            onboardingIntent: session.user.onboardingIntent,
          }}
          initialMe={me}
          initialProfile={profile}
          initialChannels={channels?.channels || me?.verified_youtube_channels || []}
          initialNotifications={notifications}
          loadErrors={{
            me: meResult.status === "rejected",
            profile: profileResult.status === "rejected",
            channels: channelsResult.status === "rejected",
            notifications: notificationsResult.status === "rejected",
          }}
        />
      </section>
    </main>
  );
}
