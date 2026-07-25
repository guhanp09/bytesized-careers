"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "../Icons";
import { StateCard } from "../ui";
import {
  markAllNotificationsRead,
  markNotificationRead,
  type BackendNotification,
} from "../../lib/backendClient";

const formatTime = (value: string) => {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "";
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
};

const labelFor = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const chipClass = (active: boolean) =>
  [
    "cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
    active
      ? "border-white/20 bg-white text-black"
      : "border-white/[0.1] bg-white/[0.035] text-white/65 hover:bg-white/[0.06] hover:text-white",
  ].join(" ");

export function NotificationList({
  accessToken,
  initialItems,
  initialUnread,
}: {
  accessToken: string;
  initialItems: BackendNotification[];
  initialUnread: number;
}) {
  const [items, setItems] = useState(initialItems);
  const [unread, setUnread] = useState(initialUnread);
  const [busyAll, setBusyAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const categoryOf = (item: BackendNotification) => (item.category || "system").toLowerCase();

  // Only surface filter chips for categories the user actually has notifications in.
  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => set.add(categoryOf(item)));
    return Array.from(set).sort();
  }, [items]);

  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        if (unreadOnly && item.read_at) return false;
        if (categoryFilter !== "all" && categoryOf(item) !== categoryFilter) return false;
        return true;
      }),
    [items, unreadOnly, categoryFilter]
  );

  const markOne = async (id: string) => {
    try {
      setError(null);
      const updated = await markNotificationRead(accessToken, id);
      setItems((current) => current.map((item) => (item.id === id ? updated : item)));
      setUnread((count) => Math.max(0, count - 1));
    } catch {
      setError("Notifications could not be updated right now.");
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">{unread ? `${unread} unread` : "All caught up"}</p>
        {unread ? (
          <button
            type="button"
            disabled={busyAll}
            className="w-fit cursor-pointer rounded-full border border-white/[0.1] bg-white/[0.035] px-4 py-2 text-xs font-semibold text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            onClick={async () => {
              setBusyAll(true);
              try {
                setError(null);
                await markAllNotificationsRead(accessToken);
                const now = new Date().toISOString();
                setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at || now })));
                setUnread(0);
              } catch {
                setError("Notifications could not be updated right now.");
              } finally {
                setBusyAll(false);
              }
            }}
          >
            {busyAll ? "Updating..." : "Mark all read"}
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="text-sm text-muted">{error}</p>
      ) : null}

      {items.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={chipClass(categoryFilter === "all")} onClick={() => setCategoryFilter("all")}>
            All
          </button>
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              className={chipClass(categoryFilter === category)}
              onClick={() => setCategoryFilter(category)}
            >
              {labelFor(category)}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-white/10" aria-hidden="true" />
          <button
            type="button"
            aria-pressed={unreadOnly}
            className={chipClass(unreadOnly)}
            onClick={() => setUnreadOnly((value) => !value)}
          >
            Unread only
          </button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <StateCard
          icon="bell"
          align="center"
          title="No notifications yet."
          description="Applications, invites, saves, and launch-free confirmations will appear here."
        />
      ) : visibleItems.length === 0 ? (
        <StateCard
          icon="bell"
          align="center"
          title="Nothing matches this filter."
          description="Try a different category, or turn off ‘Unread only’."
          action={
            <button
              type="button"
              onClick={() => {
                setCategoryFilter("all");
                setUnreadOnly(false);
              }}
              className="inline-flex h-9 cursor-pointer items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.045] px-3.5 text-xs font-semibold text-white/78 transition hover:bg-white/[0.08] hover:text-white"
            >
              Clear filters
            </button>
          }
        />
      ) : (
        <div className="divide-y divide-white/[0.08] overflow-hidden rounded-[28px] border border-white/[0.08] bg-white/[0.035]">
          {visibleItems.map((item) => {
            const content = (
              <div className="flex gap-4 px-5 py-4 transition-[background-color,transform] duration-200 hover:bg-white/[0.04]">
                <span
                  className={[
                    "mt-1.5 h-2 w-2 flex-none rounded-full transition-colors",
                    item.read_at ? "bg-white/[0.18]" : "bg-white",
                  ].join(" ")}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-white/88">{item.title}</p>
                      <span className="text-[11px] uppercase tracking-[0.14em] text-subtle">
                        {item.category || "system"}
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[11px] text-subtle">
                      <Icon name="clock" className="h-3.5 w-3.5" />
                      {formatTime(item.created_at)}
                    </span>
                  </div>
                  {item.body ? <p className="mt-1 text-sm leading-6 text-white/56">{item.body}</p> : null}
                </div>
              </div>
            );

            if (item.action_url) {
              return (
                <Link
                  key={item.id}
                  href={item.action_url}
                  className="block cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                  onClick={() => {
                    if (!item.read_at) void markOne(item.id);
                  }}
                >
                  {content}
                </Link>
              );
            }

            return (
              <button
                key={item.id}
                type="button"
                className="block w-full cursor-pointer text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                onClick={() => {
                  if (!item.read_at) void markOne(item.id);
                }}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
