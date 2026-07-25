"use client";

import React, { useEffect, useRef, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Icon } from "./Icons";
import Sidebar from "./Sidebar";
import BrandLogo from "./BrandLogo";
import DevDataSourceSwitch from "./dev/DevDataSourceSwitch";
import { PostMenu } from "./marketplace/PostMenu";
import { seoSearchTarget } from "../lib/seoFilterMatch";
import {
  getMyProfile,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type BackendNotification,
} from "../lib/backendClient";

type NotificationIconName = React.ComponentProps<typeof Icon>["name"];

const formatNotificationTime = (value: string) => {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "";

  const seconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (seconds < 60) return "Just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    day: "numeric",
  }).format(parsed);
};

const notificationIconFor = (item: BackendNotification): NotificationIconName => {
  const source = `${item.type} ${item.category || ""} ${item.resource_type || ""}`.toLowerCase();

  if (source.includes("application") || source.includes("message") || source.includes("inbox")) return "mail";
  if (source.includes("job") || source.includes("hire")) return "briefcase";
  if (source.includes("talent") || source.includes("interest")) return "user-plus";
  if (source.includes("draft")) return "file";
  if (source.includes("save")) return "bookmark";
  if (source.includes("verified") || source.includes("publish") || source.includes("live")) return "check";
  return "bell";
};

export default function Header() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [identityAvatar, setIdentityAvatar] = useState<string | null>(null);
  const [profileUsername, setProfileUsername] = useState<string | null>(null);
  const [profileDisplayName, setProfileDisplayName] = useState<string | null>(null);
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<BackendNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [searchValue, setSearchValue] = useState("");
  const [searchMode, setSearchMode] = useState<"jobs" | "talent">("jobs");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const bellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen && !bellOpen) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedMenu = menuRef.current?.contains(target);
      const clickedBell = bellRef.current?.contains(target);
      if (!clickedMenu && !clickedBell) {
        setMenuOpen(false);
        setBellOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setBellOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen, bellOpen]);

  const isAuthed = status === "authenticated";
  const showName = profileUsername || "CreatorJobs account";
  const showSub = profileDisplayName || session?.user?.name || "Profile";
  const avatarUrl = isAuthed ? profileAvatar || identityAvatar || session?.user?.image || null : null;

  useEffect(() => {
    let mounted = true;
    if (!isAuthed) return;
    const loadIdentity = async () => {
      try {
        const res = await fetch("/api/identity/status?platform=youtube");
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;
        setIdentityAvatar(data?.identity?.imageUrl || null);
      } catch {
        if (!mounted) return;
        setIdentityAvatar(null);
      }
    };
    loadIdentity();
    return () => {
      mounted = false;
    };
  }, [isAuthed]);

  useEffect(() => {
    let mounted = true;
    const token = session?.backendAccessToken;
    if (!isAuthed || !token) return;

    void (async () => {
      try {
        const profile = await getMyProfile(token);
        if (!mounted) return;
        setProfileUsername(profile.username || null);
        setProfileDisplayName(profile.display_name || null);
        setProfileAvatar(profile.avatar_url || null);
      } catch {
        if (!mounted) return;
        setProfileUsername(null);
        setProfileDisplayName(null);
        setProfileAvatar(null);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [isAuthed, session?.backendAccessToken]);

  useEffect(() => {
    let mounted = true;
    const token = session?.backendAccessToken;
    if (!isAuthed || !token) return;
    void (async () => {
      try {
        const payload = await listNotifications(token);
        if (!mounted) return;
        setNotifications(payload.items);
        setUnreadCount(payload.unread_count);
      } catch {
        if (!mounted) return;
        setNotifications([]);
        setUnreadCount(0);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [isAuthed, session?.backendAccessToken, bellOpen]);

  const markNotificationSeen = (notificationId: string) => {
    const token = session?.backendAccessToken;
    if (!token) return;

    setNotifications((items) =>
      items.map((item) => (item.id === notificationId ? { ...item, read_at: item.read_at || new Date().toISOString() } : item))
    );
    setUnreadCount((count) => Math.max(0, count - 1));

    void markNotificationRead(token, notificationId).catch(() => {
      // Keep the dropdown responsive; the full notifications page exposes update errors.
    });
  };

  return (
    <>
      <Suspense fallback={null}>
        <Sidebar />
      </Suspense>

      {/* Top header — full width; hamburger sits in the same rail column */}
      <header className="fixed top-0 left-0 right-0 z-[60] bg-[var(--vt-canvas-translucent,rgba(11,11,15,0.92))] backdrop-blur">
        <div className="h-14 flex items-center">
          {/* Rail column: NO horizontal padding (so it aligns with sidebar icons) */}
          <div className="w-20 flex items-center justify-center">
            <button
              type="button"
              className="cursor-pointer p-1 rounded-md text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
              aria-label="Menu"
            >
              <Icon name="menu" className="w-5 h-5" />
            </button>
          </div>

          {/* Rest of header: padding applies ONLY here */}
          <div className="flex-1 px-3 sm:px-4 flex items-center gap-3">
            <Link
              href="/"
              aria-label="CreatorJobs"
              className="inline-flex cursor-pointer items-center gap-[11px] leading-none text-white"
            >
              <BrandLogo height={32} className="hidden sm:inline-flex" />
              <BrandLogo height={32} className="sm:hidden" />
              <span className="hidden sm:inline font-semibold tracking-tight leading-none text-[var(--vt-ink,#ffffff)]">CreatorJobs</span>
            </Link>

            <div className="flex-1 flex items-center justify-center">
              <div className="w-full max-w-2xl flex items-center gap-2">
                <form
                  className="flex-1 flex items-center bg-[var(--vt-card,rgba(255,255,255,0.06))] border border-[var(--vt-line,rgba(255,255,255,0.1))] rounded-full overflow-hidden shadow-[var(--vt-search-shadow,0_10px_30px_-25px_rgba(0,0,0,0.9))] transition-[border-color,box-shadow] focus-within:border-[var(--vt-search-focus,rgba(255,255,255,0.1))] focus-within:shadow-[var(--vt-search-shadow-focus,0_10px_30px_-25px_rgba(0,0,0,0.9))]"
                  onSubmit={(event) => {
                    event.preventDefault();
                    // Central search-to-filter routing (curated route → role route
                    // + refinement params → ranked ?q= search). See seoSearchTarget.
                    router.push(seoSearchTarget(searchMode, searchValue).href);
                  }}
                >
                  <div
                    role="group"
                    aria-label="Search type"
                    className="my-1 ml-1 flex shrink-0 items-center rounded-full bg-white/[0.05] p-0.5"
                  >
                    {(["jobs", "talent"] as const).map((modeOption) => (
                      <button
                        key={modeOption}
                        type="button"
                        onClick={() => setSearchMode(modeOption)}
                        aria-pressed={searchMode === modeOption}
                        className={[
                          "h-7 cursor-pointer rounded-full px-2.5 text-[11px] font-semibold capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
                          searchMode === modeOption
                            ? "bg-[var(--vt-seg-active-bg,#ffffff)] text-[var(--vt-seg-active-text,#000000)]"
                            : "text-[var(--vt-text-muted,rgba(255,255,255,0.55))] hover:text-[var(--vt-ink,#ffffff)]",
                        ].join(" ")}
                      >
                        {modeOption}
                      </button>
                    ))}
                  </div>
                  <input
                    value={searchValue}
                    onChange={(event) => setSearchValue(event.target.value)}
                    className="w-full bg-transparent px-3 py-2.5 outline-none text-sm text-[var(--vt-ink,#ffffff)] placeholder:text-[var(--vt-text-faint,rgba(255,255,255,0.45))]"
                    placeholder={
                      searchMode === "talent"
                        ? "Search talent, roles, tools, portfolios, locations..."
                        : "Search jobs, roles, platforms, locations, budgets..."
                    }
                    aria-label={`Search ${searchMode}`}
                  />
                  <button
                    type="submit"
                    className="cursor-pointer px-4 py-2.5 border-l border-white/10 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                    aria-label={`Search ${searchMode}`}
                  >
                    <Icon name="search" className="w-5 h-5" />
                  </button>
                </form>

                <button
                  type="button"
                  className="hidden cursor-pointer rounded-full bg-white/10 p-2.5 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 sm:inline-flex"
                  aria-label="Voice"
                >
                  <Icon name="mic" className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <DevDataSourceSwitch />
              <PostMenu />

              <div className="relative" ref={bellRef}>
                <button
                  type="button"
                  className="relative inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                  aria-label="Notifications"
                  aria-expanded={bellOpen}
                  aria-haspopup="dialog"
                  aria-controls="notifications-popover"
                  onClick={() => setBellOpen((open) => !open)}
                >
                  <Icon name="bell-yt" className="w-[20px] h-[20px]" />
                  {unreadCount ? (
                    <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--vt-badge-bg,#ffffff)] px-1 text-[10px] font-bold text-[var(--vt-badge-text,#000000)]">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  ) : null}
                </button>

                {bellOpen ? (
                  <div
                    id="notifications-popover"
                    role="dialog"
                    aria-labelledby="notifications-popover-title"
                    className={[
                      "absolute right-0 mt-2 w-[min(calc(100vw-1rem),440px)] overflow-hidden rounded-[24px]",
                      "border border-white/[0.12] bg-[#171719] text-white/72",
                      "shadow-[0_32px_90px_-34px_rgba(0,0,0,1)]",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
                      <p id="notifications-popover-title" className="text-base font-semibold text-white/92">
                        Notifications
                      </p>
                      {unreadCount ? (
                        <button
                          type="button"
                          className="cursor-pointer rounded-full px-2.5 py-1 text-[11px] font-semibold text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                          onClick={async () => {
                            const token = session?.backendAccessToken;
                            if (!token) return;
                            await markAllNotificationsRead(token);
                            setUnreadCount(0);
                            setNotifications((items) =>
                              items.map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() }))
                            );
                          }}
                        >
                          Mark all read
                        </button>
                      ) : null}
                    </div>
                    <div className="max-h-[72vh] overflow-y-auto py-1">
                      {notifications.length ? (
                        notifications.slice(0, 8).map((item) => {
                          const unread = !item.read_at;
                          const iconName = notificationIconFor(item);
                          const row = (
                            <div
                              data-testid="notification-row"
                              className={[
                                "group relative grid grid-cols-[40px_minmax(0,1fr)] gap-x-3 py-2.5 pl-5 pr-2 text-left transition-colors",
                                unread ? "bg-white/[0.032] hover:bg-white/[0.065]" : "hover:bg-white/[0.042]",
                              ].join(" ")}
                            >
                              {unread ? (
                                <span
                                  data-testid="notification-unread-dot"
                                  aria-hidden="true"
                                  className="absolute left-1.5 top-[27px] h-2 w-2 rounded-full bg-white"
                                />
                              ) : null}
                              <span className="sr-only">{unread ? "Unread notification" : "Read notification"}</span>
                              <span
                                aria-hidden="true"
                                className={[
                                  "mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-full border",
                                  unread
                                    ? "border-white/[0.18] bg-white/[0.12] text-white"
                                    : "border-white/[0.1] bg-white/[0.06] text-muted",
                                ].join(" ")}
                              >
                                <Icon name={iconName} className="h-[18px] w-[18px]" />
                              </span>
                              <span className="min-w-0">
                                <span
                                  className={[
                                    "block text-sm font-semibold leading-5",
                                    unread ? "text-white/92" : "text-white/68",
                                  ].join(" ")}
                                >
                                  {item.title}
                                </span>
                                {item.body ? (
                                  <span className="mt-0.5 block line-clamp-2 text-[12px] leading-5 text-muted">
                                    {item.body}
                                  </span>
                                ) : null}
                                <span className="mt-1.5 block text-[11px] font-medium text-subtle">
                                  {formatNotificationTime(item.created_at)}
                                </span>
                              </span>
                            </div>
                          );

                          if (item.action_url) {
                            return (
                              <Link
                                key={item.id}
                                href={item.action_url}
                                className="block cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/20"
                                onClick={() => {
                                  setBellOpen(false);
                                  if (unread) markNotificationSeen(item.id);
                                }}
                              >
                                {row}
                              </Link>
                            );
                          }

                          if (unread) {
                            return (
                              <button
                                key={item.id}
                                type="button"
                                className="block w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/20"
                                onClick={() => markNotificationSeen(item.id)}
                              >
                                {row}
                              </button>
                            );
                          }

                          return <div key={item.id}>{row}</div>;
                        })
                      ) : (
                        <p className="px-4 py-8 text-center text-sm text-muted">
                          No notifications yet.
                        </p>
                      )}
                    </div>
                    <Link
                      href="/notifications"
                      className="block cursor-pointer border-t border-white/[0.08] px-4 py-2.5 text-center text-sm font-semibold text-white/72 transition-colors hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/20"
                      onClick={() => setBellOpen(false)}
                    >
                      View all notifications
                    </Link>
                  </div>
                ) : null}
              </div>

              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                  aria-label="Profile"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  onClick={() => {
                    setMenuOpen((open) => !open);
                  }}
                >
                  {isAuthed && avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={showName}
                      className="h-8 w-8 rounded-full object-cover border border-white/20"
                    />
                  ) : (
                    <Icon name="user" className="w-5 h-5" />
                  )}
                </button>

                {menuOpen ? (
                  <div
                    role="menu"
                    className={[
                      "absolute right-0 mt-2 w-64 rounded-xl",
                      "bg-[#111216] border border-white/10",
                      "shadow-[0_20px_60px_-25px_rgba(0,0,0,0.95)]",
                      "p-3",
                    ].join(" ")}
                  >
                    {isAuthed ? (
                      <>
                        <div className="flex items-center gap-3 px-2 py-2">
                          <div className="h-10 w-10 rounded-full border border-white/15 bg-white/10 overflow-hidden flex items-center justify-center">
                            {avatarUrl ? (
                              <img src={avatarUrl} alt={showName} className="h-full w-full object-cover" />
                            ) : (
                              <Icon name="user" className="w-5 h-5 text-white/70" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-white/90 truncate">{showName}</div>
                            <div className="text-xs text-muted truncate">{showSub}</div>
                          </div>
                        </div>

                        <div className="my-3 border-t border-white/10" />

                        <button
                          type="button"
                          className="flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-2 text-sm text-white/85 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                          onClick={() => {
                            setMenuOpen(false);
                            router.push("/you");
                          }}
                        >
                          <span className="flex items-center gap-2">
                            <Icon name="user" className="w-4 h-4" />
                            Account
                          </span>
                          <span className="text-muted">›</span>
                        </button>

                        <button
                          type="button"
                          className={[
                            "flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
                            profileUsername
                              ? "cursor-pointer text-white/85 hover:bg-white/10"
                              : "text-muted cursor-not-allowed",
                          ].join(" ")}
                          onClick={() => {
                            if (!profileUsername) return;
                            setMenuOpen(false);
                            router.push(`/u/${encodeURIComponent(profileUsername)}`);
                          }}
                          disabled={!profileUsername}
                        >
                          <span className="flex items-center gap-2">
                            <Icon name="globe" className="w-4 h-4" />
                            Public profile
                          </span>
                          <span className="text-muted">›</span>
                        </button>

                        <button
                          type="button"
                          className="flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-2 text-sm text-white/85 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                          onClick={() => {
                            setMenuOpen(false);
                            router.push("/settings");
                          }}
                        >
                          <span className="flex items-center gap-2">
                            <Icon name="settings" className="w-4 h-4" />
                            Settings
                          </span>
                          <span className="text-muted">›</span>
                        </button>

                        <button
                          type="button"
                          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-white/85 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                          onClick={() => {
                            setMenuOpen(false);
                            router.push("/support");
                          }}
                        >
                          <Icon name="inbox" className="w-4 h-4" />
                          Support
                        </button>

                        {session?.user?.accountType === "ADMIN" ? (
                          <button
                            type="button"
                            data-testid="header-admin-link"
                            className="flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-2 text-sm text-white/85 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                            onClick={() => {
                              setMenuOpen(false);
                              router.push("/admin");
                            }}
                          >
                            <span className="flex items-center gap-2">
                              <Icon name="alert" className="w-4 h-4" />
                              Admin
                            </span>
                            <span className="text-muted">›</span>
                          </button>
                        ) : null}

                        <button
                          type="button"
                          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-white/85 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                          onClick={() => signOut({ callbackUrl: "/" })}
                        >
                          <Icon name="log-out" className="w-4 h-4" />
                          Logout
                        </button>
                      </>
                    ) : (
                      <div className="space-y-2">
                        <button
                          type="button"
                          className="flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-2 text-sm text-white/85 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                          onClick={() => {
                            setMenuOpen(false);
                            router.push("/auth?mode=login");
                          }}
                        >
                          <span className="flex items-center gap-2">
                            <Icon name="user" className="w-4 h-4" />
                            Log in
                          </span>
                          <span className="text-muted">›</span>
                        </button>

                        <button
                          type="button"
                          className="flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-2 text-sm text-white/85 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                          onClick={() => {
                            setMenuOpen(false);
                            router.push("/auth?mode=signup");
                          }}
                        >
                          <span className="flex items-center gap-2">
                            <Icon name="plus" className="w-4 h-4" />
                            Sign up
                          </span>
                          <span className="text-muted">›</span>
                        </button>

                        <button
                          type="button"
                          className="flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-2 text-sm text-white/85 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                          onClick={() => {
                            setMenuOpen(false);
                            router.push("/support");
                          }}
                        >
                          <span className="flex items-center gap-2">
                            <Icon name="inbox" className="w-4 h-4" />
                            Support
                          </span>
                          <span className="text-muted">›</span>
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </header>
    </>
  );
}
