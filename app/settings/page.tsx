import Link from "next/link";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { redirect } from "next/navigation";
import type { ComponentProps } from "react";

import { Icon } from "../../components/Icons";
import { PageHeader, StateCard } from "../../components/ui";
import { authOptions } from "../../lib/auth";
import {
  getMyProfile,
  type BackendProfileResponse,
  type BackendPrivacySettings,
} from "../../lib/backendClient";
import { hasBackendSessionAuthError } from "../../lib/backendLoadState";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SettingRow = {
  title: string;
  description: string;
  status?: string;
  href?: string;
  actionLabel?: string;
  comingSoon?: boolean;
  danger?: boolean;
};

type SettingSection = {
  id: string;
  title: string;
  description: string;
  icon: ComponentProps<typeof Icon>["name"];
  rows: SettingRow[];
};

const accountTypeLabel = (value?: string | null) => {
  if (value === "TALENT") return "Talent";
  if (value === "EMPLOYER") return "Recruiter";
  if (value === "BOTH") return "Talent and recruiter";
  if (value === "ADMIN") return "Admin";
  return "Unified profile";
};

const yesNo = (value?: boolean) => (value ? "Shown" : "Hidden");

const privacyRows = (privacy?: BackendPrivacySettings): SettingRow[] => [
  {
    title: "Links",
    description: "Public profile social and website links.",
    status: privacy ? yesNo(privacy.show_links) : "Open profile editor",
    href: "/you",
    actionLabel: "Edit",
  },
  {
    title: "Tools",
    description: "Skills and tools shown on your public profile.",
    status: privacy ? yesNo(privacy.show_skills) : "Open profile editor",
    href: "/you",
    actionLabel: "Edit",
  },
  {
    title: "Location",
    description: "Whether your location appears publicly.",
    status: privacy ? yesNo(privacy.show_location) : "Open profile editor",
    href: "/you",
    actionLabel: "Edit",
  },
  {
    title: "Working hours",
    description: "Whether availability and working hours appear publicly.",
    status: privacy ? yesNo(privacy.show_availability) : "Open profile editor",
    href: "/you",
    actionLabel: "Edit",
  },
  {
    title: "YouTube badge",
    description: "Verified channel badge visibility where available.",
    status: privacy ? yesNo(privacy.show_youtube_badge) : "Open profile editor",
    href: "/you",
    actionLabel: "Edit",
  },
  {
    title: "Profile discovery",
    description: "Control profile search and marketplace discovery.",
    status: "Coming soon",
    comingSoon: true,
  },
];

const settingSections = (
  session: Session,
  profile: BackendProfileResponse | null
): SettingSection[] => {
  const username = profile?.username || session?.user?.username || null;
  const displayName = profile?.display_name || session?.user?.name || "Not set";
  const email = profile?.email || session?.user?.email || "Not available";
  const profileHref = username ? `/u/${encodeURIComponent(username)}` : "/you";
  const connectedAccounts = [
    profile?.social_connections?.youtube?.connected ? "YouTube" : null,
    profile?.social_connections?.instagram?.connected ? "Instagram" : null,
  ].filter(Boolean);

  return [
    {
      id: "account",
      title: "Account",
      description: "Identity and login details for your unified CreatorJobs account.",
      icon: "user",
      rows: [
        {
          title: "Display name",
          description: "Shown across your profile, listings, and conversations.",
          status: displayName,
          href: "/you",
          actionLabel: "Edit",
        },
        {
          title: "Username",
          description: "Your public handle and profile URL.",
          status: username ? `@${username}` : "Not set",
          href: "/you",
          actionLabel: "Edit",
        },
        {
          title: "Email",
          description: "Used for login and account communication.",
          status: email,
        },
        {
          title: "Account type",
          description: "CreatorJobs uses one profile for hiring and getting hired.",
          status: accountTypeLabel(profile?.account_type || session?.user?.accountType),
        },
        {
          title: "Connected accounts",
          description: "Accounts used for profile and channel verification.",
          status: connectedAccounts.length ? connectedAccounts.join(", ") : "Manage in profile",
          href: "/you",
          actionLabel: "Manage",
        },
        {
          title: "Delete account",
          description: "Permanent deletion belongs in Privacy, Safety & Data.",
          href: "#privacy-data",
          actionLabel: "Review",
          danger: true,
        },
      ],
    },
    {
      id: "profile-visibility",
      title: "Profile & Visibility",
      description: "Control how your unified talent and recruiter presence appears publicly.",
      icon: "globe",
      rows: [
        {
          title: "Public profile",
          description: "Preview the profile recruiters and talent can see.",
          href: profileHref,
          actionLabel: username ? "Preview" : "Set username",
          status: username ? "Available" : "Needs username",
        },
        {
          title: "Edit public profile",
          description: "Bio, work samples, roles, hiring profile, and listing content stay in /you.",
          href: "/you",
          actionLabel: "Open /you",
          status: "Active",
        },
        ...privacyRows(profile?.privacy_settings),
      ],
    },
    {
      id: "notifications",
      title: "Notifications",
      description: "Alerts for marketplace activity, messages, applications, and reminders.",
      icon: "bell",
      rows: [
        {
          title: "Notification center",
          description: "View application, hiring, draft, checkout, and profile reminders.",
          href: "/notifications",
          actionLabel: "Open",
          status: "Active",
        },
        { title: "Application updates", description: "Email and in-app application status alerts.", status: "Coming soon", comingSoon: true },
        { title: "Hiring request updates", description: "Alerts when talent responds to hiring requests.", status: "Coming soon", comingSoon: true },
        { title: "Messages", description: "Message notification preferences.", status: "Coming soon", comingSoon: true },
        { title: "Saved alerts", description: "Saved search and saved listing reminders.", status: "Coming soon", comingSoon: true },
        { title: "Recommendations", description: "Job and talent recommendations.", status: "Coming soon", comingSoon: true },
      ],
    },
    {
      id: "marketplace",
      title: "Marketplace Preferences",
      description: "Defaults and shortcuts for hiring, applying, posting, and managing work.",
      icon: "briefcase",
      rows: [
        { title: "Profile workspace", description: "Manage both talent and recruiter profile modes.", href: "/you", actionLabel: "Open", status: "Active" },
        { title: "Post a job", description: "Create a new recruiter-side job listing.", href: "/post-job", actionLabel: "Post", status: "Active" },
        { title: "Create talent listing", description: "Publish a talent-side marketplace listing.", href: "/post-talent", actionLabel: "Create", status: "Active" },
        { title: "Inbox", description: "Applications, hiring requests, replies, and outcomes.", href: "/applications", actionLabel: "Open", status: "Active" },
        { title: "Drafts", description: "Resume unfinished job and talent listings.", href: "/drafts", actionLabel: "Open", status: "Active" },
        { title: "Default hiring identity", description: "Choose a default channel/page for future jobs.", status: "Coming soon", comingSoon: true },
        { title: "Application screening", description: "Default first-message and screening preferences.", status: "Coming soon", comingSoon: true },
        { title: "Who can send hiring requests", description: "Control inbound recruiter reach-outs.", status: "Coming soon", comingSoon: true },
      ],
    },
    {
      id: "payments",
      title: "Payments, Billing & Payouts",
      description: "Payment infrastructure planned for future paid marketplace flows.",
      icon: "cash",
      rows: [
        { title: "Beta payment status", description: "CreatorJobs beta does not require a payment method to publish right now.", status: "No payment required" },
        { title: "UPI ID", description: "Receive payouts through UPI when payments launch.", status: "Coming soon", comingSoon: true },
        { title: "Payment methods", description: "Cards, UPI, and billing methods for paid products.", status: "Coming soon", comingSoon: true },
        { title: "Billing details", description: "Business name, GST, invoice address, and receipts.", status: "Coming soon", comingSoon: true },
        { title: "Invoices and receipts", description: "Download billing documents.", status: "Coming soon", comingSoon: true },
      ],
    },
    {
      id: "privacy-data",
      title: "Privacy, Safety & Data",
      description: "Data controls, legal links, safety tools, and account deletion planning.",
      icon: "shield",
      rows: [
        { title: "Privacy Policy", description: "Read how CreatorJobs handles marketplace and account data.", href: "/privacy", actionLabel: "Open", status: "Active" },
        { title: "Terms", description: "Review marketplace terms and safety expectations.", href: "/terms", actionLabel: "Open", status: "Active" },
        { title: "Blocked users", description: "Manage people you do not want to hear from.", status: "Coming soon", comingSoon: true },
        { title: "Download my data", description: "Request a data export when backend support is available.", status: "Coming soon", comingSoon: true },
        { title: "Deactivate account", description: "Temporarily hide your profile and marketplace activity.", status: "Coming soon", comingSoon: true },
        {
          title: "Delete account",
          description: "Future destructive flow requiring confirmation, retention policy, and backend deletion support.",
          status: "Planned",
          comingSoon: true,
          danger: true,
        },
      ],
    },
    {
      id: "security",
      title: "Security",
      description: "Login methods, OAuth connections, sessions, and future account protection.",
      icon: "shield",
      rows: [
        { title: "Login method", description: "Current authentication method for this session.", status: session?.user?.provider || "Email / OAuth" },
        { title: "Connected OAuth account", description: "External account used for sign-in where available.", status: session?.user?.providerAccountId ? "Connected" : "Not shown" },
        { title: "Password", description: "Password management for email accounts.", status: "Coming soon", comingSoon: true },
        { title: "Two-factor authentication", description: "Add a second layer of account protection.", status: "Coming soon", comingSoon: true },
        { title: "Sessions and devices", description: "View and revoke active sessions.", status: "Coming soon", comingSoon: true },
      ],
    },
    {
      id: "preferences",
      title: "Preferences",
      description: "Regional, language, currency, and appearance defaults.",
      icon: "settings",
      rows: [
        { title: "Timezone", description: "Used for profile availability and marketplace coordination.", status: profile?.timezone || "Not set" },
        { title: "Region", description: "CreatorJobs is India-first today, with global preferences planned.", status: "India-first beta" },
        { title: "Currency", description: "Default marketplace display currency.", status: "INR" },
        { title: "Theme", description: "CreatorJobs currently uses the dark premium theme.", status: "Dark" },
        { title: "Language", description: "Interface language preferences.", status: "Coming soon", comingSoon: true },
        { title: "Date/time format", description: "Regional date and time formatting.", status: "Coming soon", comingSoon: true },
      ],
    },
    {
      id: "support-legal",
      title: "Support & Legal",
      description: "Help, policies, and marketplace support resources.",
      icon: "help",
      rows: [
        { title: "Support", description: "Get help with account access, verification, and marketplace workflows.", href: "/support", actionLabel: "Open", status: "Active" },
        { title: "Terms", description: "CreatorJobs marketplace terms.", href: "/terms", actionLabel: "Open", status: "Active" },
        { title: "Privacy", description: "Privacy policy and data handling.", href: "/privacy", actionLabel: "Open", status: "Active" },
        { title: "Report a bug", description: "Send product issues to the CreatorJobs team.", status: "Coming soon", comingSoon: true },
        { title: "Community guidelines", description: "Marketplace conduct and safety guidance.", status: "Coming soon", comingSoon: true },
      ],
    },
  ];
};

function StatusPill({ row }: { row: SettingRow }) {
  const label = row.status || (row.href ? "Open" : "Coming soon");
  return (
    <span
      className={[
        "inline-flex min-h-7 shrink-0 items-center justify-center rounded-full border px-2.5 text-xs font-semibold",
        row.danger
          ? "border-rose-300/20 bg-rose-400/[0.08] text-rose-100"
          : row.comingSoon
            ? "border-white/[0.08] bg-white/[0.035] text-white/42"
            : "border-emerald-300/16 bg-emerald-300/[0.08] text-emerald-100",
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function SettingRowItem({ row }: { row: SettingRow }) {
  return (
    <div
      className={[
        "flex flex-col gap-3 border-t border-white/[0.07] py-4 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between",
        row.comingSoon ? "opacity-80" : "",
      ].join(" ")}
      aria-disabled={row.comingSoon || undefined}
    >
      <div className="min-w-0 space-y-1">
        <h3 className={["text-sm font-semibold", row.danger ? "text-rose-100" : "text-white/88"].join(" ")}>
          {row.title}
        </h3>
        <p className="max-w-2xl text-sm leading-6 text-white/50">{row.description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:justify-end">
        <StatusPill row={row} />
        {row.href && row.actionLabel ? (
          <Link
            href={row.href}
            className="inline-flex h-8 cursor-pointer items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.045] px-3 text-xs font-semibold text-white/72 transition-colors hover:border-white/[0.18] hover:bg-white/[0.075] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          >
            {row.actionLabel}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function SettingsSection({ section }: { section: SettingSection }) {
  return (
    <section
      id={section.id}
      data-testid={`settings-section-${section.id}`}
      className="scroll-mt-24 rounded-[28px] border border-white/[0.08] bg-white/[0.035] p-5 shadow-[0_18px_60px_-46px_rgba(0,0,0,0.95)] sm:p-6"
    >
      <div className="mb-5 flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.045] text-white/60">
          <Icon name={section.icon} className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-white">{section.title}</h2>
          <p className="max-w-2xl text-sm leading-6 text-white/52">{section.description}</p>
        </div>
      </div>
      <div>
        {section.rows.map((row) => (
          <SettingRowItem key={`${section.id}-${row.title}`} row={row} />
        ))}
      </div>
    </section>
  );
}

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
            description="Manage account, privacy, marketplace, and future billing preferences."
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

  let profile: BackendProfileResponse | null = null;
  let profileLoadFailed = false;
  try {
    profile = await getMyProfile(session.backendAccessToken);
  } catch {
    profileLoadFailed = true;
  }

  const sections = settingSections(session, profile);

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white sm:px-6 lg:py-10">
      <section className="mx-auto max-w-7xl space-y-7">
        <PageHeader
          eyebrow="Account"
          title="Settings"
          description="Manage account access, profile visibility, notifications, marketplace defaults, payments, privacy, and support from one place."
        />

        {profileLoadFailed ? (
          <div
            data-testid="settings-profile-fallback"
            className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.055] px-4 py-3 text-sm leading-6 text-amber-50/80"
          >
            Live profile details are temporarily unavailable. The Settings shell is still available with session-level account information.
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
          <nav
            aria-label="Settings sections"
            className="lg:sticky lg:top-20"
          >
            <div className="flex gap-2 overflow-x-auto rounded-2xl border border-white/[0.08] bg-white/[0.035] p-2 lg:block lg:space-y-1 lg:overflow-visible">
              {sections.map((section) => (
                <a
                  key={`settings-nav-${section.id}`}
                  href={`#${section.id}`}
                  className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-white/58 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 lg:flex"
                >
                  <Icon name={section.icon} className="h-4 w-4" />
                  <span>{section.title}</span>
                </a>
              ))}
            </div>
          </nav>

          <div className="space-y-5">
            {sections.map((section) => (
              <SettingsSection key={section.id} section={section} />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
