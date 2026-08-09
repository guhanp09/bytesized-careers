"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Icon } from "./Icons";

type NavItem = {
  href: string;
  label: string;
  icon: Parameters<typeof Icon>[0]["name"];
  auth?: boolean;
};

export default function Sidebar() {
  const pathname = usePathname();
  const { status } = useSession();
  const isAuthed = status === "authenticated";
  const focusedJobCreation = pathname.startsWith("/post-job");

  const navClass = (active: boolean) =>
    [
      "w-16 flex flex-col items-center gap-1 rounded-lg px-1 py-1 text-[12px] leading-tight text-center transition-colors cursor-pointer",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vt-accent-ring,rgba(255,255,255,0.2))]",
      active
        ? "text-[var(--vt-nav-active-text,#ffffff)] bg-[var(--vt-nav-active,transparent)] shadow-[var(--vt-nav-active-shadow,none)]"
        : "text-[var(--vt-nav-text,rgba(255,255,255,0.72))] hover:text-[var(--vt-ink,#ffffff)]",
    ].join(" ");

  const items: NavItem[] = [
    { href: "/", label: "Home", icon: "home" },
    { href: "/jobs", label: "Jobs", icon: "briefcase" },
    { href: "/talent", label: "Talent", icon: "users" },
    { href: "/you", label: "You", icon: "user" },
    { href: "/applications", label: "Inbox", icon: "mail", auth: true },
    { href: "/drafts", label: "Drafts", icon: "file", auth: true },
  ];

  const isActive = (item: NavItem) => {
    if (item.href === "/") return pathname === "/";
    return pathname.startsWith(item.href);
  };

  return (
    <aside
      className={[
        "fixed left-0 top-0 z-50 h-screen w-20 flex-col items-center gap-6 bg-[var(--vt-canvas,#0b0b0f)] border-r border-r-[var(--vt-bar-line,transparent)] pt-16",
        focusedJobCreation ? "hidden sm:flex" : "flex",
      ].join(" ")}
    >
      {items
        .filter((item) => !item.auth || isAuthed)
        .map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={navClass(active)}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              title={item.label}
            >
              <Icon name={item.icon} className="h-5 w-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}

      <div className="flex-1" />
    </aside>
  );
}
